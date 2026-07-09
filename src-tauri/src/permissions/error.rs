use thiserror::Error;

#[derive(Debug, Error)]
pub enum PermissionError {
    #[error("permission config I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("permission config (de)serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, PermissionError>;
