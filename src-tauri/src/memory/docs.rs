//! Belge kütüphanesi (RAG, Faz 8) — documents + doc_chunks tabloları.
//!
//! Kullanıcının eklediği dosyalar (pdf/docx/txt/md...) metne çevrilir,
//! ~1400 karakterlik örtüşmeli parçalara bölünür, her parça yerel embedding
//! (nomic-embed-text) ile vektörlenir. Arama hibrit: kosinüs benzerliği ana
//! skor, FTS (bm25) eşleşmesi bonus — kısa anahtar kelime sorguları da,
//! anlamsal sorgular da isabet eder.

use rusqlite::{params, Connection};
use serde::Serialize;

use super::{MemoryError, MemoryStore};

pub fn init_tables(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS documents (
          id              TEXT PRIMARY KEY,
          path            TEXT NOT NULL UNIQUE,
          title           TEXT NOT NULL,
          mime            TEXT NOT NULL,
          size_bytes      INTEGER NOT NULL,
          chunk_count     INTEGER NOT NULL,
          embedding_model TEXT NOT NULL,
          added_at        INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doc_chunks (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id        TEXT NOT NULL,
          seq           INTEGER NOT NULL,
          text          TEXT NOT NULL,
          embedding     BLOB NOT NULL,
          embedding_dim INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id, seq);

        CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
          text, content='doc_chunks', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
          INSERT INTO doc_chunks_fts(rowid, text) VALUES (new.id, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
          INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
        END;
        "#,
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub id: String,
    pub path: String,
    pub title: String,
    pub mime: String,
    pub size_bytes: i64,
    pub chunk_count: i64,
    pub added_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocHit {
    pub doc_id: String,
    pub title: String,
    pub seq: i64,
    pub text: String,
    pub score: f32,
}

/// Metni örtüşmeli parçalara böler: ~`target` karakter hedef, paragraf/cümle
/// sınırı tercih edilir, `overlap` kadar geriye taşma (bağlam kopmasın).
pub fn chunk_text(text: &str, target: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let hard_end = (start + target).min(chars.len());
        let mut end = hard_end;
        if hard_end < chars.len() {
            // Sınırı geriye doğru en yakın paragraf/cümle sonuna çek (min %60 dolu).
            let floor = start + target * 6 / 10;
            let mut best: Option<usize> = None;
            let mut i = hard_end;
            while i > floor {
                let c = chars[i - 1];
                if c == '\n' {
                    best = Some(i);
                    break;
                }
                if best.is_none() && matches!(c, '.' | '!' | '?') {
                    best = Some(i);
                }
                i -= 1;
            }
            if let Some(b) = best {
                end = b;
            }
        }
        let piece: String = chars[start..end].iter().collect();
        let trimmed = piece.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }
    out
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

impl MemoryStore {
    /// Belgeyi (meta + tüm parçaları) tek transaction'da yazar; aynı yol
    /// yeniden eklenirse eski kayıt silinip tazelenir.
    pub fn doc_insert(
        &self,
        id: &str,
        path: &str,
        title: &str,
        mime: &str,
        size_bytes: i64,
        embedding_model: &str,
        chunks: &[(String, Vec<f32>)],
    ) -> Result<(), MemoryError> {
        let mut conn = self.conn.lock().expect("memory poisoned");
        let tx = conn.transaction()?;

        // Aynı yolun eski kaydını temizle (yeniden indeksleme).
        if let Ok(old_id) = tx.query_row(
            "SELECT id FROM documents WHERE path = ?1",
            params![path],
            |r| r.get::<_, String>(0),
        ) {
            tx.execute("DELETE FROM doc_chunks WHERE doc_id = ?1", params![old_id])?;
            tx.execute("DELETE FROM documents WHERE id = ?1", params![old_id])?;
        }

        tx.execute(
            "INSERT INTO documents (id, path, title, mime, size_bytes, chunk_count, embedding_model, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                path,
                title,
                mime,
                size_bytes,
                chunks.len() as i64,
                embedding_model,
                chrono_now()
            ],
        )?;
        for (seq, (text, emb)) in chunks.iter().enumerate() {
            let bytes: Vec<u8> = emb.iter().flat_map(|f| f.to_le_bytes()).collect();
            tx.execute(
                "INSERT INTO doc_chunks (doc_id, seq, text, embedding, embedding_dim)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, seq as i64, text, bytes, emb.len() as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn docs_list(&self) -> Result<Vec<DocMeta>, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, path, title, mime, size_bytes, chunk_count, added_at
             FROM documents ORDER BY added_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DocMeta {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    title: r.get(2)?,
                    mime: r.get(3)?,
                    size_bytes: r.get(4)?,
                    chunk_count: r.get(5)?,
                    added_at: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn doc_remove(&self, id: &str) -> Result<(), MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        conn.execute("DELETE FROM doc_chunks WHERE doc_id = ?1", params![id])?;
        conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn docs_count(&self) -> Result<i64, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))?;
        Ok(n)
    }

    /// Hibrit arama: kosinüs ana skor + FTS eşleşmesine sabit bonus.
    pub fn docs_search(
        &self,
        query_embedding: &[f32],
        query_text: &str,
        top_k: usize,
    ) -> Result<Vec<DocHit>, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");

        // FTS eşleşen chunk id'leri (bm25 en iyi 64).
        let fts_query = super::sanitize_fts_query(query_text);
        let mut fts_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
        if !fts_query.is_empty() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT rowid FROM doc_chunks_fts WHERE doc_chunks_fts MATCH ?1
                 ORDER BY bm25(doc_chunks_fts) LIMIT 64",
            ) {
                if let Ok(rows) = stmt.query_map(params![fts_query], |r| r.get::<_, i64>(0)) {
                    for id in rows.flatten() {
                        fts_ids.insert(id);
                    }
                }
            }
        }

        let mut stmt = conn.prepare(
            "SELECT c.id, c.doc_id, d.title, c.seq, c.text, c.embedding, c.embedding_dim
             FROM doc_chunks c JOIN documents d ON d.id = c.doc_id",
        )?;
        let mut hits: Vec<DocHit> = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let doc_id: String = r.get(1)?;
                let title: String = r.get(2)?;
                let seq: i64 = r.get(3)?;
                let text: String = r.get(4)?;
                let blob: Vec<u8> = r.get(5)?;
                let dim: i64 = r.get(6)?;
                Ok((id, doc_id, title, seq, text, blob, dim))
            })?
            .flatten()
            .filter_map(|(id, doc_id, title, seq, text, blob, dim)| {
                if blob.len() != dim as usize * 4 {
                    return None;
                }
                let emb: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                let mut score = cosine(query_embedding, &emb);
                if fts_ids.contains(&id) {
                    score += 0.15; // anahtar kelime isabeti bonusu
                }
                Some(DocHit {
                    doc_id,
                    title,
                    seq,
                    text,
                    score,
                })
            })
            .collect();

        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(top_k);
        Ok(hits)
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
