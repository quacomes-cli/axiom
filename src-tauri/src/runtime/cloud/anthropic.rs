use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::runtime::error::RuntimeError;
use crate::runtime::provider::{ChatMessage, InferenceResponse};

const DEFAULT_BASE_URL: &str = "https://api.anthropic.com/v1";

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
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
    let url = format!("{}/messages", base_url.unwrap_or(DEFAULT_BASE_URL));

    let mut system_msg: Option<String> = None;
    let filtered: Vec<AnthropicMessage> = messages
        .into_iter()
        .filter_map(|m| {
            if m.role == "system" {
                system_msg = Some(m.content);
                None
            } else {
                Some(AnthropicMessage {
                    role: m.role,
                    content: m.content,
                })
            }
        })
        .collect();

    let body = AnthropicRequest {
        model: model_id.to_string(),
        messages: filtered,
        max_tokens: max_tokens.unwrap_or(4096),
        temperature,
        system: system_msg,
    };

    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| RuntimeError::CloudApi(e.to_string()))?;

    let data: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| RuntimeError::CloudApi(format!("JSON parse: {e}")))?;

    let content = data
        .content
        .first()
        .and_then(|c| c.text.clone())
        .unwrap_or_default();

    let tokens = data
        .usage
        .map(|u| u.input_tokens.unwrap_or(0) + u.output_tokens.unwrap_or(0));

    Ok(InferenceResponse {
        content,
        tokens_used: tokens,
        model_id: model_id.to_string(),
    })
}

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    delta: Option<AnthropicDelta>,
}

#[derive(Deserialize)]
struct AnthropicDelta {
    text: Option<String>,
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
    let url = format!("{}/messages", base_url.unwrap_or(DEFAULT_BASE_URL));

    let mut system_msg: Option<String> = None;
    let filtered: Vec<AnthropicMessage> = messages
        .into_iter()
        .filter_map(|m| {
            if m.role == "system" {
                system_msg = Some(m.content);
                None
            } else {
                Some(AnthropicMessage {
                    role: m.role,
                    content: m.content,
                })
            }
        })
        .collect();

    #[derive(Serialize)]
    struct AnthropicStreamRequest {
        model: String,
        messages: Vec<AnthropicMessage>,
        max_tokens: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        temperature: Option<f32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        system: Option<String>,
        stream: bool,
    }

    let body = AnthropicStreamRequest {
        model: model_id.to_string(),
        messages: filtered,
        max_tokens: max_tokens.unwrap_or(4096),
        temperature,
        system: system_msg,
        stream: true,
    };

    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
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

            if line.is_empty() || line.starts_with("event:") {
                continue;
            }
            if !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if let Ok(parsed) = serde_json::from_str::<AnthropicStreamEvent>(data) {
                match parsed.event_type.as_str() {
                    "content_block_delta" => {
                        if let Some(delta) = parsed.delta {
                            if let Some(text) = delta.text {
                                on_token(text, false, None, None);
                            }
                        }
                    }
                    "message_stop" => {
                        on_token(String::new(), true, None, Some("stop".to_string()));
                        return Ok(());
                    }
                    _ => {}
                }
            }
        }
    }

    on_token(String::new(), true, None, Some("stop".to_string()));
    Ok(())
}
