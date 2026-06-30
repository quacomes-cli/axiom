use std::sync::RwLock;

use crate::runtime::cloud::types::CloudProviderConfig;
use crate::runtime::cloud::CloudProvider;
use crate::runtime::error::RuntimeError;
use crate::runtime::ollama::types::OllamaShowResponse;
use crate::runtime::ollama::OllamaProvider;
use crate::runtime::optimizer::OptimizationConfig;
use crate::runtime::provider::*;

pub struct ModelRegistry {
    ollama: OllamaProvider,
    clouds: RwLock<Vec<CloudProvider>>,
    active: RwLock<Option<ActiveModelRef>>,
    optimization: RwLock<Option<OptimizationConfig>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveModelRef {
    pub provider: ProviderKind,
    pub model_id: String,
}

impl ModelRegistry {
    pub fn new(
        ollama_base_url: String,
        cloud_configs: Vec<CloudProviderConfig>,
        active: Option<ActiveModelRef>,
        optimization: Option<OptimizationConfig>,
    ) -> Self {
        let clouds = cloud_configs.into_iter().map(CloudProvider::new).collect();

        Self {
            ollama: OllamaProvider::new(ollama_base_url),
            clouds: RwLock::new(clouds),
            active: RwLock::new(active),
            optimization: RwLock::new(optimization),
        }
    }

    pub fn get_optimization(&self) -> Option<OptimizationConfig> {
        self.optimization.read().unwrap().clone()
    }

    pub fn set_optimization(&self, config: Option<OptimizationConfig>) {
        let mut opt = self.optimization.write().unwrap();
        *opt = config;
    }

    /// Convenience: route an embedding request to the Ollama provider.
    pub async fn embed_ollama(
        &self,
        model: &str,
        input: &str,
    ) -> Result<Vec<f32>, RuntimeError> {
        self.ollama.embeddings(model, input).await
    }

    pub async fn list_all_models(&self) -> Result<Vec<ModelInfo>, RuntimeError> {
        let mut all = Vec::new();
        let active = self.active.read().unwrap().clone();

        if let Ok(mut models) = self.ollama.list_models().await {
            for m in &mut models {
                m.is_active = active
                    .as_ref()
                    .is_some_and(|a| a.provider == ProviderKind::Ollama && a.model_id == m.id);
            }
            all.extend(models);
        }

        let cloud_configs: Vec<CloudProviderConfig> = {
            self.clouds
                .read()
                .unwrap()
                .iter()
                .map(|c| c.config().clone())
                .collect()
        };
        for cfg in &cloud_configs {
            let cloud = CloudProvider::new(cfg.clone());
            if let Ok(mut models) = cloud.list_models().await {
                for m in &mut models {
                    m.is_active = active
                        .as_ref()
                        .is_some_and(|a| a.provider == ProviderKind::Cloud && a.model_id == m.id);
                }
                all.extend(models);
            }
        }

        Ok(all)
    }

    pub async fn ollama_status(&self) -> bool {
        self.ollama.is_available().await
    }

    pub async fn pull_model_stream<F>(
        &self,
        provider: &ProviderKind,
        model_id: &str,
        on_progress: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, Option<u64>, Option<u64>),
    {
        match provider {
            ProviderKind::Ollama => self.ollama.pull_stream(model_id, on_progress).await,
            _ => Err(RuntimeError::ProviderNotConfigured(
                "Bu provider pull desteklemiyor".to_string(),
            )),
        }
    }

    pub async fn create_model_stream<F>(
        &self,
        provider: &ProviderKind,
        model_id: &str,
        from: &str,
        quantize: Option<&str>,
        on_progress: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, Option<u64>, Option<u64>),
    {
        match provider {
            ProviderKind::Ollama => {
                self.ollama
                    .create_stream(model_id, from, quantize, on_progress)
                    .await
            }
            _ => Err(RuntimeError::ProviderNotConfigured(
                "Bu provider model oluşturmayı desteklemiyor".to_string(),
            )),
        }
    }

    pub async fn delete_model(
        &self,
        provider: &ProviderKind,
        model_id: &str,
    ) -> Result<(), RuntimeError> {
        match provider {
            ProviderKind::Ollama => self.ollama.delete_model(model_id).await,
            _ => Err(RuntimeError::ProviderNotConfigured(
                "Bu provider silme desteklemiyor".to_string(),
            )),
        }
    }

    pub fn set_active(&self, provider: ProviderKind, model_id: String) {
        let mut active = self.active.write().unwrap();
        *active = Some(ActiveModelRef { provider, model_id });
    }

    pub fn get_active(&self) -> Option<ActiveModelRef> {
        self.active.read().unwrap().clone()
    }

    pub async fn chat(&self, req: InferenceRequest) -> Result<InferenceResponse, RuntimeError> {
        match &req.provider {
            ProviderKind::Ollama => {
                let opt = self.optimization.read().unwrap().clone();
                self.ollama.chat_with_opts(req, opt.as_ref()).await
            }
            ProviderKind::Cloud => {
                let cloud = {
                    let clouds = self.clouds.read().unwrap();
                    let cfg = clouds
                        .iter()
                        .find(|c| c.config().models.iter().any(|m| m.id == req.model_id))
                        .map(|c| c.config().clone());
                    cfg
                };
                match cloud {
                    Some(cfg) => CloudProvider::new(cfg).chat(req).await,
                    None => Err(RuntimeError::ModelNotFound(format!(
                        "Cloud model bulunamadı: {}",
                        req.model_id
                    ))),
                }
            }
            ProviderKind::LlamaCpp => Err(RuntimeError::ProviderNotConfigured(
                "llama.cpp henüz desteklenmiyor".to_string(),
            )),
        }
    }

    pub async fn chat_stream<F>(
        &self,
        req: InferenceRequest,
        on_token: F,
    ) -> Result<(), RuntimeError>
    where
        F: FnMut(String, bool, Option<String>, Option<String>),
    {
        match &req.provider {
            ProviderKind::Ollama => {
                let opt = self.optimization.read().unwrap().clone();
                self.ollama.chat_stream(req, opt.as_ref(), on_token).await
            }
            ProviderKind::Cloud => {
                let cloud_cfg = {
                    let clouds = self.clouds.read().unwrap();
                    clouds
                        .iter()
                        .find(|c| c.config().models.iter().any(|m| m.id == req.model_id))
                        .map(|c| c.config().clone())
                };
                match cloud_cfg {
                    Some(cfg) => CloudProvider::new(cfg).chat_stream(req, on_token).await,
                    None => Err(RuntimeError::ModelNotFound(format!(
                        "Cloud model bulunamadı: {}",
                        req.model_id
                    ))),
                }
            }
            ProviderKind::LlamaCpp => Err(RuntimeError::ProviderNotConfigured(
                "llama.cpp henüz desteklenmiyor".to_string(),
            )),
        }
    }

    pub fn get_cloud_configs(&self) -> Vec<CloudProviderConfig> {
        self.clouds
            .read()
            .unwrap()
            .iter()
            .map(|c| c.config().clone())
            .collect()
    }

    pub async fn show_model(&self, model_name: &str) -> Result<OllamaShowResponse, RuntimeError> {
        self.ollama.show_model(model_name).await
    }

    pub fn set_cloud_configs(&self, configs: Vec<CloudProviderConfig>) {
        let mut clouds = self.clouds.write().unwrap();
        *clouds = configs.into_iter().map(CloudProvider::new).collect();
    }
}
