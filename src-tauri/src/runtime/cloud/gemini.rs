use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::runtime::error::RuntimeError;
use crate::runtime::provider::{ChatMessage, InferenceResponse};

const BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiGenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiRespContent>,
}

#[derive(Deserialize)]
struct GeminiRespContent {
    parts: Option<Vec<GeminiRespPart>>,
}

#[derive(Deserialize)]
struct GeminiRespPart {
    text: Option<String>,
}

fn build_gemini_parts(
    messages: Vec<ChatMessage>,
) -> (Option<GeminiContent>, Vec<GeminiContent>) {
    let mut system_instruction: Option<GeminiContent> = None;
    let mut contents: Vec<GeminiContent> = Vec::new();

    for m in messages {
        if m.role == "system" {
            let part = GeminiPart { text: m.content };
            if let Some(ref mut si) = system_instruction {
                si.parts.push(part);
            } else {
                system_instruction = Some(GeminiContent {
                    role: "user".to_string(),
                    parts: vec![part],
                });
            }
        } else {
            let role = if m.role == "assistant" {
                "model".to_string()
            } else {
                "user".to_string()
            };
            contents.push(GeminiContent {
                role,
                parts: vec![GeminiPart { text: m.content }],
            });
        }
    }

    (system_instruction, contents)
}

pub async fn chat(
    client: &Client,
    api_key: &str,
    _base_url: Option<&str>,
    model_id: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<InferenceResponse, RuntimeError> {
    let url = format!(
        "{}/models/{}:generateContent?key={}",
        BASE_URL, model_id, api_key
    );

    let (system_instruction, contents) = build_gemini_parts(messages);

    let gen_config = if temperature.is_some() || max_tokens.is_some() {
        Some(GeminiGenerationConfig {
            temperature,
            max_output_tokens: max_tokens,
        })
    } else {
        None
    };

    let body = GeminiRequest {
        contents,
        system_instruction,
        generation_config: gen_config,
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| RuntimeError::CloudApi(e.to_string()))?;

    let data: GeminiResponse = resp
        .json()
        .await
        .map_err(|e| RuntimeError::CloudApi(format!("JSON parse: {e}")))?;

    let content = data
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .unwrap_or_default();

    Ok(InferenceResponse {
        content,
        tokens_used: None,
        model_id: model_id.to_string(),
    })
}

pub async fn chat_stream<F>(
    client: &Client,
    api_key: &str,
    _base_url: Option<&str>,
    model_id: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    mut on_token: F,
) -> Result<(), RuntimeError>
where
    F: FnMut(String, bool, Option<String>, Option<String>),
{
    let url = format!(
        "{}/models/{}:streamGenerateContent?alt=sse&key={}",
        BASE_URL, model_id, api_key
    );

    let (system_instruction, contents) = build_gemini_parts(messages);

    let gen_config = if temperature.is_some() || max_tokens.is_some() {
        Some(GeminiGenerationConfig {
            temperature,
            max_output_tokens: max_tokens,
        })
    } else {
        None
    };

    let body = GeminiRequest {
        contents,
        system_instruction,
        generation_config: gen_config,
    };

    let resp = client
        .post(&url)
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
            if let Ok(parsed) = serde_json::from_str::<GeminiResponse>(data) {
                let text = parsed
                    .candidates
                    .and_then(|c| c.into_iter().next())
                    .and_then(|c| c.content)
                    .and_then(|c| c.parts)
                    .and_then(|p| p.into_iter().next())
                    .and_then(|p| p.text)
                    .unwrap_or_default();
                if !text.is_empty() {
                    on_token(text, false, None, None);
                }
            }
        }
    }

    on_token(String::new(), true, None, Some("stop".to_string()));
    Ok(())
}
