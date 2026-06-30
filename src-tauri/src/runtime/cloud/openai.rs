use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::runtime::error::RuntimeError;
use crate::runtime::provider::{ChatMessage, InferenceResponse};

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
}

#[derive(Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
    usage: Option<OpenAIUsage>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIRespMessage,
}

#[derive(Deserialize)]
struct OpenAIRespMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIUsage {
    total_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct OpenAIStreamChunk {
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAIStreamChoice {
    delta: OpenAIDelta,
}

#[derive(Deserialize)]
struct OpenAIDelta {
    content: Option<String>,
}

pub async fn chat(
    client: &Client,
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<InferenceResponse, RuntimeError> {
    let url = format!("{}/chat/completions", base_url.unwrap_or(DEFAULT_BASE_URL));

    let body = OpenAIRequest {
        model: model_id.to_string(),
        messages: messages
            .into_iter()
            .map(|m| OpenAIMessage {
                role: m.role,
                content: m.content,
            })
            .collect(),
        temperature,
        max_tokens,
        stream: false,
    };

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| RuntimeError::CloudApi(e.to_string()))?;

    let data: OpenAIResponse = resp
        .json()
        .await
        .map_err(|e| RuntimeError::CloudApi(format!("JSON parse: {e}")))?;

    let content = data
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_default();

    Ok(InferenceResponse {
        content,
        tokens_used: data.usage.and_then(|u| u.total_tokens),
        model_id: model_id.to_string(),
    })
}

pub async fn chat_stream<F>(
    client: &Client,
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    mut on_token: F,
) -> Result<(), RuntimeError>
where
    F: FnMut(String, bool, Option<String>, Option<String>),
{
    let url = format!("{}/chat/completions", base_url.unwrap_or(DEFAULT_BASE_URL));

    let body = OpenAIRequest {
        model: model_id.to_string(),
        messages: messages
            .into_iter()
            .map(|m| OpenAIMessage {
                role: m.role,
                content: m.content,
            })
            .collect(),
        temperature,
        max_tokens,
        stream: true,
    };

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| RuntimeError::CloudApi(e.to_string()))?;

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| RuntimeError::CloudApi(e.to_string()))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buf.find('\n') {
            let line = buf[..newline_pos].trim().to_string();
            buf = buf[newline_pos + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                on_token(String::new(), true, None, Some("stop".to_string()));
                return Ok(());
            }
            if let Ok(parsed) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                if let Some(choice) = parsed.choices.first() {
                    if let Some(content) = &choice.delta.content {
                        on_token(content.clone(), false, None, None);
                    }
                }
            }
        }
    }

    on_token(String::new(), true, None, Some("stop".to_string()));
    Ok(())
}
