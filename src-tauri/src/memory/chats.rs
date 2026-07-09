//! Sohbet kalıcılığı — chats + chat_messages + chat_images tabloları.
//!
//! Neden localStorage değil: 5-10MB tavanı var, resimler persist edilemiyordu
//! (restart'ta kayboluyordu) ve her yazım tüm state'in serileştirilmesiydi.
//!
//! Model: frontend sohbeti bellekte tutar (UI değişmedi); mesaj finalize
//! olduğunda `chat_save` chat'in TÜM mesajlarını (resimler HARİÇ) tek
//! transaction'da yeniden yazar — mesaj başına değil, sohbet başına yazım.
//! Resimler büyük oldukları için ayrı akar: `chat_images_put` mesaj başına
//! BİR KEZ çağrılır (INSERT OR IGNORE), `chat_images_get` sohbete geçişte
//! lazy yükler. Böylece base64 resimler her kaydetmede IPC'den geçmez.
//!
//! Mesajın text dışındaki alanları (toolActions, cardData, thinking...)
//! `extra_json` kolonunda taşınır — şema, frontend tipine kilitlenmez.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::{MemoryError, MemoryStore};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChat {
    pub id: String,
    pub title: String,
    pub compacted_summary: Option<String>,
    pub created_at: i64,
    pub messages: Vec<StoredMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    /// toolActions, cardType, cardData, thinkingContent, fromToggle, imageCount…
    /// Frontend'in bildiği serbest alanlar; Rust içeriğini yorumlamaz.
    pub extra_json: Option<String>,
}

pub(super) fn init_tables(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS chats (
          id                TEXT PRIMARY KEY,
          title             TEXT NOT NULL,
          compacted_summary TEXT,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);

        CREATE TABLE IF NOT EXISTS chat_messages (
          id         TEXT PRIMARY KEY,
          chat_id    TEXT NOT NULL,
          role       TEXT NOT NULL,
          text       TEXT NOT NULL,
          extra_json TEXT,
          seq        INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, seq);

        CREATE TABLE IF NOT EXISTS chat_images (
          message_id TEXT NOT NULL,
          chat_id    TEXT NOT NULL,
          idx        INTEGER NOT NULL,
          data       BLOB NOT NULL,
          PRIMARY KEY (message_id, idx)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_images_chat ON chat_images(chat_id);
        "#,
    )?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl MemoryStore {
    /// Sohbeti (meta + tüm mesajlar, resimler hariç) tek transaction'da yazar.
    /// Mesaj listesi tamamen değiştirilir; sohbetten silinen mesajların
    /// resimleri de temizlenir.
    pub fn chat_save(&self, chat: &StoredChat) -> Result<(), MemoryError> {
        let mut conn = self.conn.lock().expect("memory poisoned");
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO chats (id, title, compacted_summary, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               compacted_summary = excluded.compacted_summary,
               updated_at = excluded.updated_at",
            params![chat.id, chat.title, chat.compacted_summary, chat.created_at, now_ms()],
        )?;
        tx.execute("DELETE FROM chat_messages WHERE chat_id = ?1", params![chat.id])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO chat_messages (id, chat_id, role, text, extra_json, seq, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for (i, m) in chat.messages.iter().enumerate() {
                stmt.execute(params![m.id, chat.id, m.role, m.text, m.extra_json, i as i64, now_ms()])?;
            }
        }
        // Artık var olmayan mesajların resimlerini temizle
        tx.execute(
            "DELETE FROM chat_images WHERE chat_id = ?1
             AND message_id NOT IN (SELECT id FROM chat_messages WHERE chat_id = ?1)",
            params![chat.id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Tüm sohbetleri mesajlarıyla yükler (resim verisi hariç), updated_at DESC.
    pub fn chats_load(&self) -> Result<Vec<StoredChat>, MemoryError> {
        let conn = self.conn.lock().expect("memory poisoned");
        let mut chats: Vec<StoredChat> = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT id, title, compacted_summary, created_at FROM chats ORDER BY updated_at DESC",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                chats.push(StoredChat {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    compacted_summary: row.get(2)?,
                    created_at: row.get(3)?,
                    messages: Vec::new(),
                });
            }
        }
        let mut stmt = conn.prepare(
            "SELECT id, role, text, extra_json FROM chat_messages WHERE chat_id = ?1 ORDER BY seq",
        )?;
        for chat in &mut chats {
            let mut rows = stmt.query(params![chat.id])?;
            while let Some(row) = rows.next()? {
                chat.messages.push(StoredMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    text: row.get(2)?,
                    extra_json: row.get(3)?,
                });
            }
        }
        Ok(chats)
    }

    pub fn chat_delete(&self, chat_id: &str) -> Result<(), MemoryError> {
        let mut conn = self.conn.lock().expect("memory poisoned");
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM chat_images WHERE chat_id = ?1", params![chat_id])?;
        tx.execute("DELETE FROM chat_messages WHERE chat_id = ?1", params![chat_id])?;
        tx.execute("DELETE FROM chats WHERE id = ?1", params![chat_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Bir mesajın resimlerini kaydeder. Idempotent: mesaj için zaten kayıt
    /// varsa dokunmaz (resimler immutable — mesajla doğar, mesajla ölür).
    pub fn chat_images_put(
        &self,
        chat_id: &str,
        message_id: &str,
        images_base64: &[String],
    ) -> Result<(), MemoryError> {
        use base64::Engine as _;
        let mut conn = self.conn.lock().expect("memory poisoned");
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO chat_images (message_id, chat_id, idx, data) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for (i, b64) in images_base64.iter().enumerate() {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| MemoryError::Sqlite(rusqlite::Error::ToSqlConversionFailure(Box::new(e))))?;
                stmt.execute(params![message_id, chat_id, i as i64, bytes])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Bir sohbetin tüm resimlerini mesaj bazında döner (sohbete geçişte lazy yükleme).
    pub fn chat_images_load(&self, chat_id: &str) -> Result<Vec<(String, Vec<String>)>, MemoryError> {
        use base64::Engine as _;
        let conn = self.conn.lock().expect("memory poisoned");
        let mut stmt = conn.prepare(
            "SELECT message_id, data FROM chat_images WHERE chat_id = ?1 ORDER BY message_id, idx",
        )?;
        let mut rows = stmt.query(params![chat_id])?;
        let mut out: Vec<(String, Vec<String>)> = Vec::new();
        while let Some(row) = rows.next()? {
            let mid: String = row.get(0)?;
            let data: Vec<u8> = row.get(1)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            match out.last_mut() {
                Some((last_mid, imgs)) if *last_mid == mid => imgs.push(b64),
                _ => out.push((mid, vec![b64])),
            }
        }
        Ok(out)
    }
}
