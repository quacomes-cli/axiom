#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("Ollama: {0}")]
    Ollama(String),
    #[error("Cloud API: {0}")]
    CloudApi(String),
    #[error("HTTP: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Model bulunamadı: {0}")]
    ModelNotFound(String),
    #[error("Provider yapılandırılmamış: {0}")]
    ProviderNotConfigured(String),
}
