mod client;
pub mod lifecycle;
pub mod types;

use client::OllamaClient;
use types::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::optimizer::OptimizationConfig;
use crate::runtime::provider::*;

pub struct OllamaProvider {
    client: OllamaClient,
}

impl OllamaProvider {
    pub fn new(base_url: String) -> Self {
        Self {
            client: OllamaClient::new(base_url),
        }
    }

    pub async fn embeddings(
        &self,
        model: &str,
        input: &str,
    ) -> Result<Vec<f32>, RuntimeError> {
        self.client.embeddings(model, input).await
    }

    fn build_options(
        req_temp: Option<f32>,
        req_max_tokens: Option<u32>,
        req_num_ctx: Option<u32>,
        opt: Option<&OptimizationConfig>,
    ) -> Option<OllamaChatOptions> {
        let base = opt.map(|o| o.to_ollama_options());

        match base {
            Some(mut opts) => {
                opts.temperature = req_temp.or(opts.temperature);
                opts.num_predict = req_max_tokens.or(opts.num_predict);
                // İstek num_ctx verirse profil değerini geçersiz kıl
                if req_num_ctx.is_some() {
                    opts.num_ctx = req_num_ctx;
                }
                Some(opts)
            }
            None => {
                if req_temp.is_some() || req_max_tokens.is_some() || req_num_ctx.is_some() {
                    Some(OllamaChatOptions {
                        temperature: req_temp,
                        num_predict: req_max_tokens,
                        num_gpu: None,
                        num_thread: None,
                        num_ctx: req_num_ctx,
                        num_batch: None,
                        mmap: None,
                        use_mlock: None,
                    })
                } else {
                    None
                }
            }
        }
    }
}

#[async_trait::async_trait]
impl ModelProvider for OllamaProvider {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError> {
        let tags = self.client.list_tags().await?;

        // Her model için /api/show'u paralel çağırıp capabilities'i çek.
        // Show yerel ve hızlı; join_all ile tek tur gecikme.
        let cap_futures = tags
            .models
            .iter()
            .map(|m| {
                let name = m.name.clone();
                async move {
                    self.client
                        .show(&name)
                        .await
                        .ok()
                        .and_then(|r| r.capabilities)
                }
            })
            .collect::<Vec<_>>();
        let caps = futures_util::future::join_all(cap_futures).await;

        let models = tags
            .models
            .into_iter()
            .zip(caps.into_iter())
            .map(|(m, capabilities)| ModelInfo {
                id: m.name.clone(),
                provider: ProviderKind::Ollama,
                display_name: m.name,
                size_bytes: Some(m.size),
                quantization: m.details.quantization_level,
                parameter_count: m.details.parameter_size,
                context_length: None,
                is_active: false,
                family: m.details.family,
                capabilities,
            })
            .collect();
        Ok(models)
    }

    async fn delete_model(&self, model_id: &str) -> Result<(), RuntimeError> {
        self.client.delete(model_id).await
    }

    async fn chat(&self, req: InferenceRequest) -> Result<InferenceResponse, RuntimeError> {
        self.chat_with_opts(req, None).await
    }

    async fn is_available(&self) -> bool {
        self.client.health().await
    }
}

/// Ollama, birimsiz süre string'ini reddeder ("-1" → 400 "missing unit in
/// duration"). Kayıtlı ayarlarda çıplak sayı kalmış olabilir — burada
/// normalize edilir: negatif → "-1m" (kalıcı), diğer çıplak sayılar dakika.
fn normalize_keep_alive(v: Option<String>) -> Option<String> {
    let s = v?;
    let t = s.trim();
    match t.parse::<i64>() {
        Ok(n) if n < 0 => Some("-1m".to_string()),
        Ok(n) => Some(format!("{n}m")),
        Err(_) => Some(s),
    }
}

impl OllamaProvider {
    pub async fn chat_with_opts(
        &self,
        req: InferenceRequest,
        opt: Option<&OptimizationConfig>,
    ) -> Result<InferenceResponse, RuntimeError> {
        let options = Self::build_options(req.temperature, req.max_tokens, req.num_ctx, opt);
        let keep_alive = normalize_keep_alive(opt.and_then(|o| o.keep_alive.clone()));

        let ollama_req = OllamaChatRequest {
            model: req.model_id.clone(),
            messages: req
                .messages
                .into_iter()
                .map(|m| OllamaChatMessage {
                    role: m.role.clone(),
                    content: m.content,
                    images: m.images,
                })
                .collect(),
            stream: false,
            options,
            think: Some(false),
            keep_alive,
            tools: req.tools,
        };

        let resp = self.client.chat(ollama_req).await?;
        // Native tool çağrılarını ```tool:...``` blok metnine çevir — non-stream
        // yol (agent görevleri, Telegram) da native calling'den yararlansın.
        let mut content = resp.message.content;
        if let Some(calls) = &resp.message.tool_calls {
            for call in calls {
                content.push_str(&client::tool_call_to_block(
                    &call.function.name,
                    &call.function.arguments,
                ));
            }
        }
        Ok(InferenceResponse {
            content,
            tokens_used: resp.eval_count,
            model_id: req.model_id,
        })
    }

    pub async fn show_model(
        &self,
        model_name: &str,
    ) -> Result<types::OllamaShowResponse, RuntimeError> {
        self.client.show(model_name).await
    }

    pub async fn pull_stream<F>(
        &self,
        model_id: &str,
        on_progress: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, Option<u64>, Option<u64>),
    {
        self.client.pull_stream(model_id, on_progress).await
    }

    pub async fn create_stream<F>(
        &self,
        model_id: &str,
        from: &str,
        quantize: Option<&str>,
        on_progress: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, Option<u64>, Option<u64>),
    {
        self.client
            .create_stream(model_id, from, quantize, on_progress)
            .await
    }

    pub async fn chat_stream<F>(
        &self,
        req: InferenceRequest,
        opt: Option<&OptimizationConfig>,
        on_token: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, bool, Option<String>, Option<String>),
    {
        let options = Self::build_options(req.temperature, req.max_tokens, req.num_ctx, opt);
        let keep_alive = normalize_keep_alive(opt.and_then(|o| o.keep_alive.clone()));
        let think = if req.think.unwrap_or(false) { Some(true) } else { None };

        let ollama_req = OllamaChatRequest {
            model: req.model_id,
            messages: req
                .messages
                .into_iter()
                .map(|m| OllamaChatMessage {
                    role: m.role.clone(),
                    content: m.content,
                    images: m.images,
                })
                .collect(),
            stream: true,
            options,
            think,
            keep_alive,
            tools: req.tools,
        };

        self.client.chat_stream(ollama_req, on_token).await
    }
}
