mod anthropic;
mod gemini;
mod openai;
pub mod types;

use reqwest::Client;

use self::types::{CloudModelDef, CloudProviderConfig};
use crate::runtime::error::RuntimeError;
use crate::runtime::provider::*;

pub struct CloudProvider {
    client: Client,
    config: CloudProviderConfig,
}

impl CloudProvider {
    pub fn new(config: CloudProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    pub fn config(&self) -> &CloudProviderConfig {
        &self.config
    }

    fn to_model_info(&self, def: &CloudModelDef) -> ModelInfo {
        ModelInfo {
            id: def.id.clone(),
            provider: ProviderKind::Cloud,
            display_name: format!("{} ({})", def.display_name, self.config.name),
            size_bytes: None,
            quantization: None,
            parameter_count: None,
            context_length: def.context_length,
            is_active: false,
            family: Some(self.config.name.clone()),
            capabilities: Some(vec!["completion".into(), "tools".into()]),
        }
    }
}

#[async_trait::async_trait]
impl ModelProvider for CloudProvider {
    async fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError> {
        if !self.config.enabled {
            return Ok(vec![]);
        }
        Ok(self
            .config
            .models
            .iter()
            .map(|m| self.to_model_info(m))
            .collect())
    }

    async fn delete_model(&self, _model_id: &str) -> Result<(), RuntimeError> {
        Err(RuntimeError::ProviderNotConfigured(
            "Cloud modelleri silinemez".to_string(),
        ))
    }

    async fn chat(&self, req: InferenceRequest) -> Result<InferenceResponse, RuntimeError> {
        if !self.config.enabled || self.config.api_key.is_empty() {
            return Err(RuntimeError::ProviderNotConfigured(format!(
                "{} API anahtarı yapılandırılmamış",
                self.config.name
            )));
        }

        let base_url = self.config.base_url.as_deref();

        match self.config.name.as_str() {
            "openai" => {
                openai::chat(
                    &self.client,
                    &self.config.api_key,
                    base_url,
                    &req.model_id,
                    req.messages,
                    req.temperature,
                    req.max_tokens,
                )
                .await
            }
            "anthropic" => {
                anthropic::chat(
                    &self.client,
                    &self.config.api_key,
                    base_url,
                    &req.model_id,
                    req.messages,
                    req.temperature,
                    req.max_tokens,
                )
                .await
            }
            "gemini" => {
                // Native function calling: tools şemaları functionDeclarations'a
                // çevrilir; yanıt functionCall'ları blok metnine döner (2b).
                let tools = req.tools;
                gemini::chat(
                    &self.client,
                    &self.config.api_key,
                    base_url,
                    &req.model_id,
                    req.messages,
                    req.temperature,
                    req.max_tokens,
                    tools.as_ref(),
                )
                .await
            }
            other => Err(RuntimeError::ProviderNotConfigured(format!(
                "Bilinmeyen cloud provider: {other}"
            ))),
        }
    }

    async fn is_available(&self) -> bool {
        self.config.enabled && !self.config.api_key.is_empty()
    }
}

impl CloudProvider {
    pub async fn chat_stream<F>(
        &self,
        req: InferenceRequest,
        on_token: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, bool, Option<String>, Option<String>),
    {
        if !self.config.enabled || self.config.api_key.is_empty() {
            return Err(RuntimeError::ProviderNotConfigured(format!(
                "{} API anahtarı yapılandırılmamış",
                self.config.name
            )));
        }

        let base_url = self.config.base_url.as_deref();

        match self.config.name.as_str() {
            "openai" => {
                openai::chat_stream(
                    &self.client,
                    &self.config.api_key,
                    base_url,
                    &req.model_id,
                    req.messages,
                    req.temperature,
                    req.max_tokens,
                    on_token,
                )
                .await
            }
            "anthropic" => {
                anthropic::chat_stream(
                    &self.client,
                    &self.config.api_key,
                    base_url,
                    &req.model_id,
                    req.messages,
                    req.temperature,
                    req.max_tokens,
                    on_token,
                )
                .await
            }
            "gemini" => {
                let tools = req.tools;
                gemini::chat_stream(
                    &self.client,
                    &self.config.api_key,
                    base_url,
                    &req.model_id,
                    req.messages,
                    req.temperature,
                    req.max_tokens,
                    tools.as_ref(),
                    on_token,
                )
                .await
            }
            other => Err(RuntimeError::ProviderNotConfigured(format!(
                "Bilinmeyen cloud provider: {other}"
            ))),
        }
    }
}
