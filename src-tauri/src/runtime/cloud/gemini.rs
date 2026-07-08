use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::runtime::error::RuntimeError;
use crate::runtime::ollama::tool_call_to_block;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<GeminiTool>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiTool {
    function_declarations: Vec<serde_json::Value>,
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
#[serde(rename_all = "camelCase")]
struct GeminiRespPart {
    text: Option<String>,
    /// Native function calling yanıtı: {name, args}.
    function_call: Option<GeminiFunctionCall>,
}

#[derive(Deserialize)]
struct GeminiFunctionCall {
    name: String,
    #[serde(default)]
    args: serde_json::Value,
}

/// Ollama-format tools listesini ([{type:"function", function:{name,description,
/// parameters}}]) Gemini `functionDeclarations`'a çevirir. Şemalar Gemini'nin
/// OpenAPI alt kümesine daraltılır (bilinmeyen anahtarlar 400 döndürebiliyor —
/// özellikle MCP şemalarındaki additionalProperties/$schema).
fn to_function_declarations(tools: &serde_json::Value) -> Option<Vec<GeminiTool>> {
    let arr = tools.as_array()?;
    let decls: Vec<serde_json::Value> = arr
        .iter()
        .filter_map(|t| {
            let f = t.get("function")?;
            let name = f.get("name")?.as_str()?.to_string();
            let mut decl = serde_json::json!({ "name": name });
            if let Some(desc) = f.get("description").and_then(|d| d.as_str()) {
                decl["description"] = serde_json::Value::String(desc.to_string());
            }
            if let Some(params) = f.get("parameters") {
                let cleaned = sanitize_schema(params);
                // Boş properties'li şema Gemini'de sorun çıkarabilir — parametresiz
                // araçlarda parameters alanını tamamen atla.
                let has_props = cleaned
                    .get("properties")
                    .and_then(|p| p.as_object())
                    .map(|o| !o.is_empty())
                    .unwrap_or(false);
                if has_props {
                    decl["parameters"] = cleaned;
                }
            }
            Some(decl)
        })
        .collect();
    if decls.is_empty() {
        None
    } else {
        Some(vec![GeminiTool {
            function_declarations: decls,
        }])
    }
}

/// JSON Schema'yı Gemini'nin kabul ettiği alt kümeye daraltır: yalnızca
/// type/description/properties/required/items/enum anahtarları (özyinelemeli).
fn sanitize_schema(schema: &serde_json::Value) -> serde_json::Value {
    match schema {
        serde_json::Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                match k.as_str() {
                    "type" | "description" | "enum" | "required" => {
                        out.insert(k.clone(), v.clone());
                    }
                    "properties" => {
                        if let Some(props) = v.as_object() {
                            let cleaned: serde_json::Map<String, serde_json::Value> = props
                                .iter()
                                .map(|(pk, pv)| (pk.clone(), sanitize_schema(pv)))
                                .collect();
                            out.insert(k.clone(), serde_json::Value::Object(cleaned));
                        }
                    }
                    "items" => {
                        out.insert(k.clone(), sanitize_schema(v));
                    }
                    _ => {} // $schema, additionalProperties, default, format... atla
                }
            }
            serde_json::Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Yanıt partlarını tek metne indirger: text partları birleşir, functionCall
/// partları frontend'in yürüttüğü ```tool:...``` blok metnine çevrilir
/// (Ollama native yolundaki dönüşümün aynısı — parser/yürütme sıfır değişiklik).
fn parts_to_text(parts: Vec<GeminiRespPart>) -> String {
    let mut out = String::new();
    for p in parts {
        if let Some(t) = p.text {
            out.push_str(&t);
        }
        if let Some(fc) = p.function_call {
            out.push_str(&tool_call_to_block(&fc.name, &fc.args));
        }
    }
    out
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
    tools: Option<&serde_json::Value>,
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
        tools: tools.and_then(to_function_declarations),
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
        .map(parts_to_text)
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
    tools: Option<&serde_json::Value>,
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
        tools: tools.and_then(to_function_declarations),
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
                    .map(parts_to_text)
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
