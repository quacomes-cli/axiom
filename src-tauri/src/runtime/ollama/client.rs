use futures_util::StreamExt;
use reqwest::Client;

use super::types::*;
use crate::runtime::error::RuntimeError;

/// Native tool çağrısını frontend'in anladığı ```tool:...``` blok metnine çevirir.
/// Gövde biçimi, chatStore.parseToolBlocks'un kind başına beklediği formatla
/// eşleşmek zorunda: web_search/run_command ham satır, write_file `path` + `---`
/// ayracı, geri kalanı `anahtar: değer` satırları.
pub(crate) fn tool_call_to_block(name: &str, args: &serde_json::Value) -> String {
    fn arg_str(args: &serde_json::Value, key: &str) -> String {
        match args.get(key) {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(v) if !v.is_null() => v.to_string(),
            _ => String::new(),
        }
    }

    // MCP araçları: native ad `mcp__<server>__<tool>` biçiminde gelir. Bunu
    // yürütme yolunun anladığı tek `tool:mcp_call` bloğuna çevir — server/tool
    // satırları + `---` ardından ham JSON argümanlar (write_file ile aynı desen).
    if let Some(rest) = name.strip_prefix("mcp__") {
        if let Some((server, tool)) = rest.split_once("__") {
            let args_json = serde_json::to_string(args).unwrap_or_else(|_| "{}".into());
            return format!(
                "\n```tool:mcp_call\nserver: {server}\ntool: {tool}\n---\n{args_json}\n```\n"
            );
        }
    }

    let body = match name {
        "web_search" | "search_docs" => arg_str(args, "query"),
        "run_command" => arg_str(args, "command"),
        "write_file" => format!("path: {}\n---\n{}", arg_str(args, "path"), arg_str(args, "content")),
        _ => args
            .as_object()
            .map(|o| {
                o.iter()
                    .map(|(k, v)| {
                        let val = match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        format!("{k}: {val}")
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default(),
    };

    if body.trim().is_empty() {
        format!("\n```tool:{name}\n```\n")
    } else {
        format!("\n```tool:{name}\n{body}\n```\n")
    }
}

pub struct OllamaClient {
    client: Client,
    base_url: String,
}

impl OllamaClient {
    pub fn new(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
        }
    }

    pub async fn health(&self) -> bool {
        self.client
            .get(&self.base_url)
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
            .is_ok()
    }

    pub async fn list_tags(&self) -> Result<OllamaTagsResponse, RuntimeError> {
        let resp = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await?
            .error_for_status()
            .map_err(|e| RuntimeError::Ollama(e.to_string()))?;

        resp.json::<OllamaTagsResponse>()
            .await
            .map_err(|e| RuntimeError::Ollama(format!("JSON parse hatası: {e}")))
    }

    pub async fn embeddings(
        &self,
        model: &str,
        input: &str,
    ) -> Result<Vec<f32>, RuntimeError> {
        #[derive(serde::Serialize)]
        struct EmbedRequest<'a> {
            model: &'a str,
            input: &'a str,
        }
        #[derive(serde::Deserialize)]
        struct EmbedResponse {
            embeddings: Vec<Vec<f32>>,
        }

        let resp = self
            .client
            .post(format!("{}/api/embed", self.base_url))
            .json(&EmbedRequest { model, input })
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await?
            .error_for_status()
            .map_err(|e| RuntimeError::Ollama(e.to_string()))?;

        let data: EmbedResponse = resp
            .json()
            .await
            .map_err(|e| RuntimeError::Ollama(format!("JSON parse hatası: {e}")))?;

        data.embeddings
            .into_iter()
            .next()
            .ok_or_else(|| RuntimeError::Ollama("boş embedding cevabı".into()))
    }

    /// Hata durumunda Ollama'nın yanıt gövdesini de mesaja taşır — 400'lerde
    /// asıl neden ("missing unit in duration", "does not support images"…)
    /// gövdede yazar; salt status ile teşhis imkânsız.
    async fn error_with_body(resp: reqwest::Response) -> RuntimeError {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
            .unwrap_or(body);
        RuntimeError::Ollama(format!("HTTP {status}: {}", detail.trim()))
    }

    pub async fn chat(&self, req: OllamaChatRequest) -> Result<OllamaChatResponse, RuntimeError> {
        let resp = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_with_body(resp).await);
        }

        resp.json::<OllamaChatResponse>()
            .await
            .map_err(|e| RuntimeError::Ollama(format!("JSON parse hatası: {e}")))
    }

    /// Streams a model pull, reporting progress as (status, completed_bytes, total_bytes).
    pub async fn pull_stream<F>(
        &self,
        model_name: &str,
        mut on_progress: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, Option<u64>, Option<u64>),
    {
        let req = OllamaPullRequest {
            name: model_name.to_string(),
            stream: true,
        };

        let resp = self
            .client
            .post(format!("{}/api/pull", self.base_url))
            .json(&req)
            .timeout(std::time::Duration::from_secs(3600))
            .send()
            .await?
            .error_for_status()
            .map_err(|e| RuntimeError::Ollama(e.to_string()))?;

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| RuntimeError::Ollama(e.to_string()))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buf.find('\n') {
                let line = buf[..newline_pos].trim().to_string();
                buf = buf[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(err) = val.get("error").and_then(|e| e.as_str()) {
                        return Err(RuntimeError::Ollama(err.to_string()));
                    }
                    let status = val
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();
                    let completed = val.get("completed").and_then(|c| c.as_u64());
                    let total = val.get("total").and_then(|t| t.as_u64());
                    on_progress(status, completed, total);
                }
            }
        }

        Ok(())
    }

    /// Streams a model creation (e.g. quantizing `from` into a new `model` tag),
    /// reporting progress as (status, completed_bytes, total_bytes).
    pub async fn create_stream<F>(
        &self,
        model_name: &str,
        from: &str,
        quantize: Option<&str>,
        mut on_progress: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, Option<u64>, Option<u64>),
    {
        let mut body = serde_json::json!({
            "model": model_name,
            "from": from,
            "stream": true,
        });
        if let Some(q) = quantize {
            body["quantize"] = serde_json::Value::String(q.to_string());
        }

        let resp = self
            .client
            .post(format!("{}/api/create", self.base_url))
            .json(&body)
            .timeout(std::time::Duration::from_secs(3600))
            .send()
            .await?
            .error_for_status()
            .map_err(|e| RuntimeError::Ollama(e.to_string()))?;

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| RuntimeError::Ollama(e.to_string()))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buf.find('\n') {
                let line = buf[..newline_pos].trim().to_string();
                buf = buf[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(err) = val.get("error").and_then(|e| e.as_str()) {
                        return Err(RuntimeError::Ollama(err.to_string()));
                    }
                    let status = val
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();
                    let completed = val.get("completed").and_then(|c| c.as_u64());
                    let total = val.get("total").and_then(|t| t.as_u64());
                    on_progress(status, completed, total);
                }
            }
        }

        Ok(())
    }

    pub async fn chat_stream<F>(
        &self,
        req: OllamaChatRequest,
        mut on_token: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, bool, Option<String>, Option<String>),
    {
        let resp = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_with_body(resp).await);
        }

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| RuntimeError::Ollama(e.to_string()))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buf.find('\n') {
                let line = buf[..newline_pos].trim().to_string();
                buf = buf[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if let Ok(parsed) = serde_json::from_str::<OllamaChatResponse>(&line) {
                    let done = parsed.done.unwrap_or(false);
                    let mut token = parsed.message.content;
                    // Native tool çağrılarını mevcut ```tool:...``` blok formatına
                    // çevirip metin olarak akıt — üst katmanların (event zinciri,
                    // frontend regex parser) hiçbiri değişmeden native calling
                    // devreye girer.
                    if let Some(calls) = &parsed.message.tool_calls {
                        for call in calls {
                            token.push_str(&tool_call_to_block(
                                &call.function.name,
                                &call.function.arguments,
                            ));
                        }
                    }
                    let thinking = parsed.message.thinking;
                    let done_reason = if done { parsed.done_reason } else { None };
                    if !token.is_empty() || thinking.is_some() || done {
                        on_token(token, done, thinking, done_reason);
                    }
                    if done {
                        return Ok(());
                    }
                }
            }
        }

        Ok(())
    }

    pub async fn show(&self, model_name: &str) -> Result<OllamaShowResponse, RuntimeError> {
        let req = OllamaShowRequest {
            name: model_name.to_string(),
        };

        let resp = self
            .client
            .post(format!("{}/api/show", self.base_url))
            .json(&req)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| RuntimeError::Ollama(e.to_string()))?;

        resp.json::<OllamaShowResponse>()
            .await
            .map_err(|e| RuntimeError::Ollama(format!("JSON parse hatası: {e}")))
    }

    pub async fn delete(&self, model_name: &str) -> Result<(), RuntimeError> {
        let req = OllamaDeleteRequest {
            name: model_name.to_string(),
        };

        self.client
            .delete(format!("{}/api/delete", self.base_url))
            .json(&req)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| RuntimeError::Ollama(e.to_string()))?;

        Ok(())
    }
}
