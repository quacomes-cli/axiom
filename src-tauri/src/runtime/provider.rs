use serde::{Deserialize, Serialize};

use super::error::RuntimeError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Ollama,
    Cloud,
    LlamaCpp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub provider: ProviderKind,
    pub display_name: String,
    pub size_bytes: Option<u64>,
    pub quantization: Option<String>,
    pub parameter_count: Option<String>,
    pub context_length: Option<u32>,
    pub is_active: bool,
    pub family: Option<String>,
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceRequest {
    pub model_id: String,
    pub provider: ProviderKind,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub think: Option<bool>,
    /// İstek başına bağlam penceresi override'ı (Ollama num_ctx). Kod aracı modelin
    /// tam bağlamını kullanabilsin diye; None ise optimizasyon profili geçerli.
    #[serde(default)]
    pub num_ctx: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceResponse {
    pub content: String,
    pub tokens_used: Option<u32>,
    pub model_id: String,
}

#[async_trait::async_trait]
pub trait ModelProvider: Send + Sync {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError>;
    async fn delete_model(&self, model_id: &str) -> Result<(), RuntimeError>;
    async fn chat(&self, req: InferenceRequest) -> Result<InferenceResponse, RuntimeError>;
    async fn is_available(&self) -> bool;
}
