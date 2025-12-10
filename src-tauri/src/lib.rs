use base64::{engine::general_purpose, Engine as _};
use dotenv::dotenv;
use serde_json::{json, Value};
use std::env;
use std::fs;
use tauri::command;
use tauri_plugin_shell::ShellExt;

const PROMPT_AUFTRAG: &str = include_str!("../../src/prompts/PromptAuftrag.txt");
const PROMPT_RECHNUNG: &str = include_str!("../../src/prompts/PromptRechnung.txt");

#[command]
async fn analyze_document(
    app: tauri::AppHandle,
    path: String,
    doc_type: String,
) -> Result<Value, String> {
    dotenv().ok();
    const API_KEY: &str = env!("MISTRAL_API_KEY");
    let api_key = API_KEY;

    let mut extracted_text = String::new();

    let sidecar_command = app
        .shell()
        .sidecar("pdftotext")
        .map_err(|e| format!("Sidecar Konfiguration Fehler: {}", e))?
        .args(&["-layout", "-enc", "UTF-8", &path, "-"]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("Konnte Sidecar nicht ausführen: {}", e))?;

    if output.status.success() {
        extracted_text = String::from_utf8_lossy(&output.stdout).to_string();
    }

    let layout_instruction: String;

    if extracted_text.trim().len() < 50 {
        let file_bytes = fs::read(&path).map_err(|e| format!("Konnte Datei nicht lesen: {}", e))?;

        let b64_doc = general_purpose::STANDARD.encode(file_bytes);

        let client = reqwest::Client::new();
        let ocr_body = json!({
            "model": "mistral-ocr-latest",
            "document": {
                "type": "document_url",
                "document_url": format!("data:application/pdf;base64,{}", b64_doc)
            }
        });

        let ocr_res = client
            .post("https://api.mistral.ai/v1/ocr")
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&ocr_body)
            .send()
            .await
            .map_err(|e| format!("OCR Request fehlgeschlagen: {}", e))?;

        if !ocr_res.status().is_success() {
            return Err(format!("Mistral OCR Fehler: Status {}", ocr_res.status()));
        }

        let ocr_json: Value = ocr_res.json().await.map_err(|e| e.to_string())?;

        if let Some(pages) = ocr_json.get("pages").and_then(|p| p.as_array()) {
            extracted_text = pages
                .iter()
                .filter_map(|p| p.get("markdown").and_then(|m| m.as_str()))
                .collect::<Vec<&str>>()
                .join("\n\n");
        } else {
            return Err("Mistral OCR hat kein verständliches Ergebnis geliefert.".to_string());
        }

        layout_instruction =
            "DAS LAYOUT IST MARKDOWN. Tabellen sind mit Pipes '|' markiert. Nutze diese Struktur."
                .to_string();
    } else {
        layout_instruction = "DAS LAYOUT IST 'WHITESPACE'. Spalten sind nur durch Leerzeichen getrennt. Es gibt keine Linien. Erschließe die Spalten visuell.".to_string();
    }

    // Prompt Auswahl
    let base_prompt = if doc_type == "rechnung" {
        PROMPT_RECHNUNG
    } else {
        PROMPT_AUFTRAG
    };

    // Prompt zusammenbauen
    let full_prompt = format!(
        "{}\n\nWICHTIGE LAYOUT-INFO: {}\n\nDokument Inhalt:\n{}",
        base_prompt, layout_instruction, extracted_text
    );

    let client = reqwest::Client::new();
    let body = json!({
        "model": "mistral-large-latest",
        "messages": [
            { "role": "user", "content": full_prompt }
        ],
        "response_format": { "type": "json_object" }
    });

    // Anfrage an Mistral
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
        .ok_or("Kein Inhalt in der Antwort")?;

    // JSON Parsing
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
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![analyze_document])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
