// Long-term conversational memory for Axiom.
//
// Stores embedded chat turns in a local SQLite database and exposes a simple
// top-k cosine-similarity recall API. Vector storage uses a raw BLOB column;
// recall pulls all rows for the active strategy and computes cosine in-memory.
// At conversational scales (10K-100K turns) this is plenty fast (~ms) and
// avoids pulling in a native vector extension.
//
// Schema (created on open):
//   memory_chunks(
//     id              INTEGER PRIMARY KEY AUTOINCREMENT,
//     chat_id         TEXT NOT NULL,
//     message_id      TEXT NOT NULL,
//     role            TEXT NOT NULL,                -- "user" | "assistant"
//     text            TEXT NOT NULL,
//     embedding       BLOB NOT NULL,                -- f32 LE bytes
//     embedding_dim   INTEGER NOT NULL,
//     embedding_model TEXT NOT NULL,
//     created_at      INTEGER NOT NULL              -- ms epoch
//   );
//
// Indexes:
//   - chat_id, created_at (for per-chat clear + recency-weighted recall)

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("dimension mismatch: stored {stored}, query {query}")]
    DimMismatch { stored: usize, query: usize },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct MemoryStore {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHit {
    pub id: i64,
    pub chat_id: String,
    pub message_id: String,
    pub role: String,
    pub text: String,
    pub score: f32,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub total_chunks: i64,
    pub total_chats: i64,
    pub embedding_model: Option<String>,
    pub db_size_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub chat_id: String,
    pub chat_title: Option<String>,
    pub message_id: String,
    pub role: String,
    pub text: String,
    pub created_at: i64,
    pub snippet: String,
    pub score: f64,
}

/// Strip FTS5 special operators so a free-form user query doesn't trip the
/// MATCH grammar. We convert all whitespace-separated tokens into a
/// space-separated query, dropping bare punctuation.
fn sanitize_fts_query(q: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for raw_tok in q.split_whitespace() {
        let cleaned: String = raw_tok
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if cleaned.len() >= 2 {
            // Append a prefix wildcard for partial matches (e.g. "rust" -> "rust*").
            out.push(format!("{}*", cleaned));
        } else if !cleaned.is_empty() {
            out.push(cleaned);
        }
    }
    out.join(" ")
}

impl MemoryStore {
    pub fn open(db_path: &Path) -> Result<Self, MemoryError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS memory_chunks (
              id              INTEGER PRIMARY KEY AUTOINCREMENT,
              chat_id         TEXT NOT NULL,
              message_id      TEXT NOT NULL,
              role            TEXT NOT NULL,
              text            TEXT NOT NULL,
              embedding       BLOB NOT NULL,
              embedding_dim   INTEGER NOT NULL,
              embedding_model TEXT NOT NULL,
              created_at      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memory_chat ON memory_chunks(chat_id);
            CREATE INDEX IF NOT EXISTS idx_memory_msg ON memory_chunks(message_id);
            CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_chunks(created_at DESC);

            -- Full-text search index for chat history. Independent from the
            -- embedding store so it works even when long-term memory is off.
            CREATE TABLE IF NOT EXISTS messages (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              chat_id     TEXT NOT NULL,
              chat_title  TEXT,
              message_id  TEXT NOT NULL UNIQUE,
              role        TEXT NOT NULL,
              text        TEXT NOT NULL,
              created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
              text,
              content='messages',
              content_rowid='id',
              tokenize='unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
              INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
              INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
              INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
              INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
            END;
            "#,
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn store(
        &self,
        chat_id: &str,
        message_id: &str,
        role: &str,
        text: &str,
        embedding: &[f32],
        embedding_model: &str,
    ) -> Result<i64, MemoryError> {
        let bytes: Vec<u8> = embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let conn = self.conn.lock().expect("memory poisoned");
        conn.execute(
            "INSERT INTO memory_chunks
             (chat_id, message_id, role, text, embedding, embedding_dim, embedding_model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                chat_id,
                message_id,
                role,
                text,
                bytes,
                embedding.len() as i64,
                embedding_model,
                now,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Top-k cosine recall across ALL chats, optionally restricted to a chat.
    /// `exclude_chat_id` lets you skip the current conversation so old memory
    /// surfaces but the model isn't shown its own recent turns.
    pub fn recall(
        &self,
        query: &[f32],
        top_k: usize,
        exclude_chat_id: Option<&str>,
        only_chat_id: Option<&str>,
    ) -> Result<Vec<MemoryHit>, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let (sql, has_param): (&str, bool) = match (exclude_chat_id, only_chat_id) {
            (None, Some(_)) => (
                "SELECT id, chat_id, message_id, role, text, embedding, embedding_dim, created_at
                 FROM memory_chunks WHERE chat_id = ?1",
                true,
            ),
            (Some(_), None) => (
                "SELECT id, chat_id, message_id, role, text, embedding, embedding_dim, created_at
                 FROM memory_chunks WHERE chat_id <> ?1",
                true,
            ),
            _ => (
                "SELECT id, chat_id, message_id, role, text, embedding, embedding_dim, created_at
                 FROM memory_chunks",
                false,
            ),
        };

        let mut stmt = conn.prepare(sql)?;
        let q_norm = l2_norm(query);
        if q_norm == 0.0 {
            return Ok(vec![]);
        }

        let mut heap: Vec<MemoryHit> = Vec::new();

        let mut rows = if has_param {
            let p = exclude_chat_id.or(only_chat_id).unwrap();
            stmt.query(params![p])?
        } else {
            stmt.query([])?
        };

        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let chat_id: String = row.get(1)?;
            let message_id: String = row.get(2)?;
            let role: String = row.get(3)?;
            let text: String = row.get(4)?;
            let blob: Vec<u8> = row.get(5)?;
            let dim: i64 = row.get(6)?;
            let created_at: i64 = row.get(7)?;

            if dim as usize != query.len() {
                continue; // skip mixed-dim entries (e.g. model swap)
            }
            let stored = bytes_to_f32(&blob);
            let s_norm = l2_norm(&stored);
            if s_norm == 0.0 {
                continue;
            }
            let mut dot = 0.0f32;
            for i in 0..query.len() {
                dot += query[i] * stored[i];
            }
            let score = dot / (q_norm * s_norm);
            heap.push(MemoryHit {
                id,
                chat_id,
                message_id,
                role,
                text,
                score,
                created_at,
            });
        }

        heap.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        heap.truncate(top_k);
        Ok(heap)
    }

    pub fn clear_chat(&self, chat_id: &str) -> Result<usize, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let n = conn.execute("DELETE FROM memory_chunks WHERE chat_id = ?1", params![chat_id])?;
        Ok(n)
    }

    pub fn clear_all(&self) -> Result<usize, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let n = conn.execute("DELETE FROM memory_chunks", [])?;
        Ok(n)
    }

    /// Index a chat message for full-text search. Idempotent on message_id.
    pub fn index_message(
        &self,
        chat_id: &str,
        chat_title: Option<&str>,
        message_id: &str,
        role: &str,
        text: &str,
    ) -> Result<(), MemoryError> {
        if text.trim().is_empty() {
            return Ok(());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let conn = self.conn.lock().expect("memory poisoned");
        conn.execute(
            "INSERT INTO messages (chat_id, chat_title, message_id, role, text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(message_id) DO UPDATE SET
               text = excluded.text,
               chat_title = excluded.chat_title",
            params![chat_id, chat_title, message_id, role, text, now],
        )?;
        Ok(())
    }

    pub fn delete_chat_messages(&self, chat_id: &str) -> Result<usize, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let n = conn.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])?;
        Ok(n)
    }

    /// FTS5 search across all chat messages. Returns ranked snippets.
    pub fn search_messages(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SearchHit>, MemoryError> {
        let cleaned = sanitize_fts_query(query);
        if cleaned.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn.lock().expect("memory poisoned");
        let mut stmt = conn.prepare(
            "SELECT m.chat_id, m.chat_title, m.message_id, m.role, m.text, m.created_at,
                    snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snip,
                    bm25(messages_fts) AS score
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             WHERE messages_fts MATCH ?1
             ORDER BY score ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![cleaned, limit as i64], |row| {
            Ok(SearchHit {
                chat_id: row.get(0)?,
                chat_title: row.get(1)?,
                message_id: row.get(2)?,
                role: row.get(3)?,
                text: row.get(4)?,
                created_at: row.get(5)?,
                snippet: row.get(6)?,
                score: row.get(7)?,
            })
        })?;
        let hits: Result<Vec<_>, _> = rows.collect();
        Ok(hits?)
    }

    pub fn stats(&self, db_path: &Path) -> Result<MemoryStats, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let total_chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM memory_chunks", [], |r| r.get(0))
            .unwrap_or(0);
        let total_chats: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT chat_id) FROM memory_chunks",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let embedding_model: Option<String> = conn
            .query_row(
                "SELECT embedding_model FROM memory_chunks ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
        let db_size_bytes = std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
        Ok(MemoryStats {
            total_chunks,
            total_chats,
            embedding_model,
            db_size_bytes,
        })
    }
}

fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn l2_norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}
