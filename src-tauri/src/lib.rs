use dotenv::dotenv;
use pdf_oxide::PdfDocument;
use serde_json::{json, Value};
use std::env;
use tauri::command;

const PROMPT_AUFTRAG: &str = include_str!("../../src/prompts/PromptAuftrag.txt");
const PROMPT_RECHNUNG: &str = include_str!("../../src/prompts/PromptRechnung.txt");

#[command]
async fn analyze_document(path: String, doc_type: String) -> Result<Value, String> {
    dotenv().ok();
    let api_key = env::var("MISTRAL_API_KEY").map_err(|_| "API Key fehlt")?;

    let mut doc = PdfDocument::open(&path).map_err(|e| format!("PDF Fehler: {}", e))?;
    let markdown = doc
        .to_markdown_all(&Default::default())
        .map_err(|e| format!("Markdown Fehler: {}", e))?;

    let base_prompt = if doc_type == "rechnung" {
        PROMPT_RECHNUNG
    } else {
        PROMPT_AUFTRAG
    };

    let full_prompt = format!("{}\n{}", base_prompt, markdown);

    let client = reqwest::Client::new();
    let body = json!({
        "model": "mistral-medium-latest",
        "messages": [
            { "role": "user", "content": full_prompt }
        ],
        "response_format": { "type": "json_object" }
    });

    let res = client
        .post("https://api.mistral.ai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API Fehler: {}", res.status()));
    }

    let json_res: Value = res.json().await.map_err(|e| e.to_string())?;

    let content_str = json_res["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Kein Inhalt")?;

    let result_obj: Value =
        serde_json::from_str(content_str).map_err(|e| format!("JSON Parse Fehler: {}", e))?;

    Ok(result_obj)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![analyze_document])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
