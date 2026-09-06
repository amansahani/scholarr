use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{error, info};

use crate::models::LLMConfig;

#[derive(Debug, Serialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAIMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatCompletionResponse {
    pub choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
pub struct Choice {
    pub message: OpenAIMessage,
}

#[derive(Debug, Serialize)]
pub struct EmbeddingRequest {
    pub model: String,
    pub input: String,
}

#[derive(Debug, Deserialize)]
pub struct EmbeddingResponse {
    pub data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
pub struct EmbeddingData {
    pub embedding: Vec<f32>,
    pub index: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIErrorResponse {
    pub error: Option<OpenAIErrorDetail>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIErrorDetail {
    pub message: String,
}

pub struct LLMService {
    client: Client,
}

impl LLMService {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .unwrap_or_default();
        Self { client }
    }

    /// Complete a chat conversation with full context
    pub async fn complete(
        &self,
        config: &LLMConfig,
        messages: Vec<OpenAIMessage>,
    ) -> Result<String> {
        let (url, api_key, model) = Self::resolve_chat_endpoint(config);

        if api_key.trim().is_empty() && !url.contains("localhost") && !url.contains("127.0.0.1") {
            return Err(anyhow::anyhow!(
                "No API Key provided for LLM provider '{}'. Please configure your API key in the web Settings modal or in the .env file.",
                config.provider
            ));
        }

        let payload = ChatCompletionRequest {
            model: model.clone(),
            messages,
            temperature: Some(config.temperature),
            max_tokens: Some(config.max_tokens),
        };

        info!("Sending request to LLM at {} with model {}", url, model);

        let mut req_builder = self.client.post(&url).json(&payload);

        if !api_key.trim().is_empty() {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key.trim()));
        }

        // Standard compatibility headers for OpenRouter / Anthropic
        req_builder = req_builder.header("HTTP-Referer", "http://localhost:8080");
        req_builder = req_builder.header("X-Title", "Scholarr Research Mentor");

        let response = req_builder
            .send()
            .await
            .with_context(|| format!("Failed to connect to LLM endpoint at {}", url))?;

        let status = response.status();
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read response body".to_string());

        if !status.is_success() {
            if let Ok(err_resp) = serde_json::from_str::<OpenAIErrorResponse>(&body_text) {
                if let Some(err) = err_resp.error {
                    return Err(anyhow::anyhow!("LLM Error ({}): {}", status, err.message));
                }
            }
            error!("LLM request failed with status {}: {}", status, body_text);
            return Err(anyhow::anyhow!("LLM request failed with status {}: {}", status, body_text));
        }

        let parsed: ChatCompletionResponse = serde_json::from_str(&body_text)
            .with_context(|| format!("Failed to parse LLM response: {}", body_text))?;

        if let Some(first_choice) = parsed.choices.into_iter().next() {
            Ok(Self::clean_llm_response(&first_choice.message.content))
        } else {
            Err(anyhow::anyhow!("LLM returned empty choices in response"))
        }
    }

    /// Clean up any raw pseudo-tool-call markup produced by smaller LLMs (like Liquid/LFM) into clean markdown code blocks
    fn clean_llm_response(text: &str) -> String {
        let mut processed = text.to_string();

        // 1. Unwrap `<|tool_call_start|>[python_code_block(..., code='...')]<|tool_call_end|>`
        if processed.contains("<|tool_call_start|>") {
            let re_start = "<|tool_call_start|>";
            let re_end = "<|tool_call_end|>";

            while let Some(start_idx) = processed.find(re_start) {
                if let Some(end_idx) = processed[start_idx..].find(re_end) {
                    let total_end = start_idx + end_idx + re_end.len();
                    let inner = &processed[start_idx + re_start.len()..start_idx + end_idx];
                    
                    let mut extracted_code = String::new();

                    // Check for code='...' or code="..."
                    if let Some(code_pos) = inner.find("code=") {
                        let after_code = &inner[code_pos + 5..];
                        if after_code.starts_with('\'') || after_code.starts_with('"') {
                            let quote_char = after_code.chars().next().unwrap();
                            let content_part = &after_code[1..];
                            if let Some(quote_end) = content_part.rfind(quote_char) {
                                let raw_code = &content_part[..quote_end];
                                extracted_code = raw_code
                                    .replace("\\n", "\n")
                                    .replace("\\'", "'")
                                    .replace("\\\"", "\"")
                                    .replace("\\\\", "\\");
                            }
                        }
                    } else if inner.contains("execute_bash(command='") {
                        if let Some(cmd_pos) = inner.find("command='") {
                            let after = &inner[cmd_pos + 9..];
                            if let Some(end) = after.find('\'') {
                                extracted_code = after[..end].to_string();
                            }
                        }
                    }

                    let replacement = if !extracted_code.trim().is_empty() {
                        format!("\n```python\n{}\n```\n", extracted_code.trim())
                    } else {
                        "".to_string()
                    };

                    processed.replace_range(start_idx..total_end, &replacement);
                } else {
                    break;
                }
            }
        }

        processed
    }

    /// Generate vector embedding for a string using configured embedding model (e.g. liquid/lfm-2.5-embedding-350m:free)
    pub async fn embed_text(&self, config: &LLMConfig, text: &str) -> Result<Vec<f32>> {
        let (url, api_key, model) = Self::resolve_embedding_endpoint(config);

        if api_key.trim().is_empty() && !url.contains("localhost") && !url.contains("127.0.0.1") {
            return Err(anyhow::anyhow!(
                "No API Key provided for embedding provider. Configure in Settings modal or .env"
            ));
        }

        let payload = EmbeddingRequest {
            model: model.clone(),
            input: text.to_string(),
        };

        info!("Sending embedding request to {} with model {}", url, model);

        let mut req_builder = self.client.post(&url).json(&payload);

        if !api_key.trim().is_empty() {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key.trim()));
        }

        req_builder = req_builder.header("HTTP-Referer", "http://localhost:8080");
        req_builder = req_builder.header("X-Title", "Scholarr Research Mentor");

        let response = req_builder
            .send()
            .await
            .with_context(|| format!("Failed to connect to embedding endpoint at {}", url))?;

        let status = response.status();
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read embedding body".to_string());

        if !status.is_success() {
            if let Ok(err_resp) = serde_json::from_str::<OpenAIErrorResponse>(&body_text) {
                if let Some(err) = err_resp.error {
                    return Err(anyhow::anyhow!("Embedding Error ({}): {}", status, err.message));
                }
            }
            return Err(anyhow::anyhow!("Embedding API returned status {}: {}", status, body_text));
        }

        let parsed: EmbeddingResponse = serde_json::from_str(&body_text)
            .with_context(|| format!("Failed to parse embedding response: {}", body_text))?;

        if let Some(first) = parsed.data.into_iter().next() {
            Ok(first.embedding)
        } else {
            Err(anyhow::anyhow!("Empty embedding data in response"))
        }
    }

    /// Calculate Cosine Similarity between two embedding vectors
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }
        dot / (norm_a * norm_b)
    }

    /// Helper to test if configuration and key work for chat and embeddings
    pub async fn test_connection(&self, config: &LLMConfig) -> Result<String> {
        let messages = vec![
            OpenAIMessage {
                role: "system".to_string(),
                content: "You are a helpful assistant. Reply with only: 'Scholarr LLM connection successful!'".to_string(),
            },
            OpenAIMessage {
                role: "user".to_string(),
                content: "ping".to_string(),
            },
        ];

        let chat_result = self.complete(config, messages).await?;
        
        // Try testing embedding endpoint
        let emb_status = match self.embed_text(config, "test query").await {
            Ok(vec) => format!("Embeddings active (dim: {})", vec.len()),
            Err(e) => format!("Embeddings notice: {}", e),
        };

        Ok(format!("{} | {}", chat_result, emb_status))
    }

    /// Resolve Chat API URL, default models, and endpoints based on provider
    fn resolve_chat_endpoint(config: &LLMConfig) -> (String, String, String) {
        let mut base_url = config.base_url.trim().to_string();
        let api_key = config.api_key.trim().to_string();
        let mut model = config.model.trim().to_string();

        match config.provider.to_lowercase().as_str() {
            "openrouter" => {
                if base_url.is_empty() {
                    base_url = "https://openrouter.ai/api/v1".to_string();
                }
                if model.is_empty() {
                    model = "poolside/laguna-s-2.1:free".to_string();
                }
            }
            "gemini" => {
                if base_url.is_empty() {
                    base_url = "https://generativelanguage.googleapis.com/v1beta/openai/".to_string();
                }
                if model.is_empty() {
                    model = "gemini-2.5-flash".to_string();
                }
            }
            "openai" => {
                if base_url.is_empty() {
                    base_url = "https://api.openai.com/v1/".to_string();
                }
                if model.is_empty() {
                    model = "gpt-4o".to_string();
                }
            }
            "groq" => {
                if base_url.is_empty() {
                    base_url = "https://api.groq.com/openai/v1/".to_string();
                }
                if model.is_empty() {
                    model = "llama-3.3-70b-versatile".to_string();
                }
            }
            "ollama" => {
                if base_url.is_empty() {
                    base_url = "http://localhost:11434/v1/".to_string();
                }
                if model.is_empty() {
                    model = "llama3.2".to_string();
                }
            }
            "anthropic" => {
                if base_url.is_empty() {
                    base_url = "https://openrouter.ai/api/v1".to_string();
                }
                if model.is_empty() {
                    model = "anthropic/claude-3.5-sonnet".to_string();
                }
            }
            _ => {
                if base_url.is_empty() {
                    base_url = "https://openrouter.ai/api/v1".to_string();
                }
                if model.is_empty() {
                    model = "poolside/laguna-s-2.1:free".to_string();
                }
            }
        }

        let mut final_url = base_url.trim_end_matches('/').to_string();
        if !final_url.ends_with("/chat/completions") {
            final_url.push_str("/chat/completions");
        }

        (final_url, api_key, model)
    }

    /// Resolve Embedding API URL and model
    fn resolve_embedding_endpoint(config: &LLMConfig) -> (String, String, String) {
        let mut base_url = config.base_url.trim().to_string();
        let api_key = config.api_key.trim().to_string();
        let mut model = config.embedding_model.trim().to_string();

        if model.is_empty() {
            model = "liquid/lfm-2.5-embedding-350m:free".to_string();
        }

        if base_url.is_empty() {
            base_url = "https://openrouter.ai/api/v1".to_string();
        }

        // Normalize base url
        let mut final_url = base_url.trim_end_matches('/').to_string();
        if final_url.ends_with("/chat/completions") {
            final_url = final_url.trim_end_matches("/chat/completions").to_string();
        }
        if !final_url.ends_with("/embeddings") {
            final_url.push_str("/embeddings");
        }

        (final_url, api_key, model)
    }
}
