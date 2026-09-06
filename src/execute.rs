use axum::{extract::State, Json};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use tokio::{fs, process::Command, time::timeout};
use tracing::error;

use crate::routes::{ApiResponse, AppState};

#[derive(Debug, Deserialize)]
pub struct ExecutePythonRequest {
    pub code: String,
    #[serde(default)]
    pub execution_type: Option<String>, // "plot", "math", "manim", "general"
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutePythonResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub execution_time_ms: u128,
    pub images_base64: Vec<String>, // Rendered PNG figures
    pub videos_base64: Vec<String>, // Rendered Manim MP4/GIF animations
    pub execution_type: String,
}

/// Execute Python code directly in a sandboxed directory
pub async fn run_python_isolated(code: &str, execution_type: Option<&str>, timeout_secs: Option<u64>) -> Result<ExecutePythonResult, String> {
    let start_time = std::time::Instant::now();
    let max_timeout = timeout_secs.unwrap_or(45).clamp(5, 120);

    let session_id = uuid::Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir().join(format!("scholarr_sandbox_{}", session_id));

    if let Err(e) = fs::create_dir_all(&temp_dir).await {
        error!("Failed to create sandbox directory: {}", e);
        return Err(format!("Failed to initialize sandbox environment: {}", e));
    }

    let is_manim = code.contains("from manim import")
        || (code.contains("class ") && code.contains("Scene):"))
        || execution_type == Some("manim");

    let script_path = temp_dir.join("script.py");

    let wrapped_code = if is_manim {
        // Manim script
        code.to_string()
    } else {
        // Wrap standard Python script with headless matplotlib hook and figure autosaver
        format!(
            r#"# Scholarr Python Sandbox Wrapper
import sys
import os

# Configure headless matplotlib
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    _HAS_MATPLOTLIB = True
except Exception:
    _HAS_MATPLOTLIB = False

# User Script Start
{}
# User Script End

# Auto-save any active matplotlib plots to disk if user created one
if _HAS_MATPLOTLIB:
    try:
        figs = [plt.figure(n) for n in plt.get_fignums()]
        for idx, fig in enumerate(figs):
            fig_path = os.path.join(r"{}", f"output_plot_{{idx}}.png")
            fig.tight_layout()
            fig.savefig(fig_path, dpi=160, bbox_inches='tight')
            plt.close(fig)
    except Exception as _e:
        sys.stderr.write(f"\n[Plot Saver Error: {{_e}}]\n")
"#,
            code,
            temp_dir.to_string_lossy()
        )
    };

    if let Err(e) = fs::write(&script_path, wrapped_code).await {
        let _ = fs::remove_dir_all(&temp_dir).await;
        return Err(format!("Failed to write script to sandbox: {}", e));
    }

    let python_bin = std::env::var("PYTHON_PATH")
        .or_else(|_| std::env::var("PYTHON_BIN"))
        .unwrap_or_else(|_| "python3".to_string());

    let mut cmd = if is_manim {
        let mut c = Command::new(&python_bin);
        c.current_dir(&temp_dir)
            .args(&["-m", "manim", "render", "-ql", "--format=mp4", "script.py"])
            .env("MPLBACKEND", "Agg")
            .env("PYTHONUNBUFFERED", "1");
        c
    } else {
        let mut c = Command::new(&python_bin);
        c.current_dir(&temp_dir)
            .arg(&script_path)
            .env("MPLBACKEND", "Agg")
            .env("PYTHONUNBUFFERED", "1");
        c
    };

    let execution_future = cmd.output();
    let output_res = timeout(Duration::from_secs(max_timeout), execution_future).await;
    let elapsed = start_time.elapsed().as_millis();

    let (stdout_str, stderr_str, exit_code) = match output_res {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            (stdout, stderr, output.status.code())
        }
        Ok(Err(e)) => {
            let _ = fs::remove_dir_all(&temp_dir).await;
            return Err(format!("Failed to execute Python process: {}", e));
        }
        Err(_) => {
            let _ = fs::remove_dir_all(&temp_dir).await;
            return Err(format!("Execution timed out after {} seconds.", max_timeout));
        }
    };

    // Scan sandbox for generated images (.png, .jpg) and videos (.mp4, .gif)
    let mut images_base64 = Vec::new();
    let mut videos_base64 = Vec::new();

    if let Ok(mut entries) = fs::read_dir(&temp_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                let ext_lower = ext.to_lowercase();
                if ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg" {
                    if let Ok(bytes) = fs::read(&path).await {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                        images_base64.push(format!("data:image/png;base64,{}", b64));
                    }
                }
            }
        }
    }

    // Check media subdirectories created by Manim (filter out partial movie chunks, only pick final videos)
    let media_dir = temp_dir.join("media");
    if media_dir.exists() {
        find_final_videos_sync(&media_dir, &mut videos_base64);
    }

    // Clean up temporary sandbox directory
    let _ = fs::remove_dir_all(&temp_dir).await;

    Ok(ExecutePythonResult {
        stdout: stdout_str,
        stderr: stderr_str,
        exit_code,
        execution_time_ms: elapsed,
        images_base64,
        videos_base64,
        execution_type: if is_manim { "manim".to_string() } else { "plot".to_string() },
    })
}

/// Router endpoint for executing Python code in an isolated temporary sandbox
pub async fn execute_python_code(
    State(_state): State<AppState>,
    Json(payload): Json<ExecutePythonRequest>,
) -> Json<ApiResponse<ExecutePythonResult>> {
    match run_python_isolated(&payload.code, payload.execution_type.as_deref(), payload.timeout_secs).await {
        Ok(result) => Json(ApiResponse {
            success: true,
            data: Some(result),
            error: None,
        }),
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        }),
    }
}

fn find_final_videos_sync(dir: &Path, videos: &mut Vec<String>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let path_str = path.to_string_lossy();
            // Skip partial video chunks
            if path_str.contains("partial_movie_files") {
                continue;
            }
            if path.is_dir() {
                find_final_videos_sync(&path, videos);
            } else if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                if ext.eq_ignore_ascii_case("mp4") || ext.eq_ignore_ascii_case("gif") {
                    if let Ok(bytes) = std::fs::read(&path) {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                        let mime = if ext.eq_ignore_ascii_case("mp4") {
                            "video/mp4"
                        } else {
                            "image/gif"
                        };
                        videos.push(format!("data:{};base64,{}", mime, b64));
                    }
                }
            }
        }
    }
}

/// Extract all python code blocks from markdown text
pub fn extract_python_blocks(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut in_block = false;
    let mut current_block = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```python") || (trimmed == "```" && in_block) {
            if in_block {
                blocks.push(current_block.join("\n"));
                current_block.clear();
                in_block = false;
            } else if trimmed.starts_with("```python") {
                in_block = true;
            }
        } else if in_block {
            current_block.push(line);
        }
    }

    blocks
}

/// Replace a python code block in markdown text with new code
pub fn replace_python_block(text: &str, old_code: &str, new_code: &str) -> String {
    let old_snippet = format!("```python\n{}\n```", old_code.trim());
    let new_snippet = format!("```python\n{}\n```", new_code.trim());
    text.replace(&old_snippet, &new_snippet)
}
