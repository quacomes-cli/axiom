use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct OllamaTagsResponse {
    pub models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub details: OllamaModelDetails,
}

#[derive(Debug, Deserialize)]
pub struct OllamaModelDetails {
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<OllamaChatOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub think: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<String>,
    /// Native function-calling şemaları (frontend toolRegistry'den, opak JSON).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OllamaChatOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_gpu: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_thread: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_batch: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mmap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_mlock: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaChatResponse {
    pub message: OllamaChatResponseMessage,
    pub eval_count: Option<u32>,
    pub done: Option<bool>,
    pub done_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaChatResponseMessage {
    pub content: String,
    #[serde(default)]
    pub thinking: Option<String>,
    /// Native tool çağrıları: [{function: {name, arguments: {...}}}]
    #[serde(default)]
    pub tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaToolCall {
    pub function: OllamaToolCallFunction,
}

#[derive(Debug, Deserialize)]
pub struct OllamaToolCallFunction {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct OllamaPullRequest {
    pub name: String,
    pub stream: bool,
}

#[derive(Debug, Serialize)]
pub struct OllamaDeleteRequest {
    pub name: String,
}

// ---- Show API (/api/show) ----

#[derive(Debug, Serialize)]
pub struct OllamaShowRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct OllamaShowResponse {
    pub details: OllamaShowDetails,
    pub model_info: Option<serde_json::Value>,
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaShowDetails {
    pub parent_model: Option<String>,
    pub format: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}
