use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudProviderConfig {
    pub name: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub enabled: bool,
    pub models: Vec<CloudModelDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudModelDef {
    pub id: String,
    pub display_name: String,
    pub context_length: Option<u32>,
}
