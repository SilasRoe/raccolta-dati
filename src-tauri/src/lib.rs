use base64::{engine::general_purpose, Engine as _};
use dotenv::dotenv;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::time::Duration;
use tauri::command;
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

const PROMPT_AUFTRAG: &str = include_str!("../../src/prompts/PromptAuftrag.txt");
const PROMPT_RECHNUNG: &str = include_str!("../../src/prompts/PromptRechnung.txt");

#[command]
async fn analyze_document(
    app: tauri::AppHandle,
    path: String,
    doc_type: String,
) -> Result<Value, String> {
    dotenv().ok();
    let api_key = env::var("MISTRAL_API_KEY")
        .map_err(|e| format!("MISTRAL_API_KEY environment variable not set: {}", e))?;

    let mut extracted_text = String::new();
    let mut used_ocr = false;

    let sidecar_command = app
        .shell()
        .sidecar("pdftotext")
        .map_err(|e| format!("Sidecar Konfiguration Fehler: {}", e))?
        .args(&["-enc", "UTF-8", &path, "-"]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("Konnte Sidecar nicht ausführen: {}", e))?;

    if output.status.success() {
        extracted_text = String::from_utf8_lossy(&output.stdout).to_string();
    }

    println!("pdftotext: \n{}", extracted_text);

    let mut layout_instruction: String;

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

        println!("ocr: \n{}", path);

        used_ocr = true;

        layout_instruction =
            "THE LAYOUT IS MARKDOWN. Tables are marked with pipes '|'. Use this structure."
                .to_string();

        sleep(Duration::from_millis(2000)).await;
    } else {
        layout_instruction = "THE LAYOUT IS ‘WHITESPACE’. Columns are separated only by spaces. There are no lines. Visualize the columns.".to_string();
    }

    let base_prompt = if doc_type == "rechnung" {
        PROMPT_RECHNUNG
    } else {
        PROMPT_AUFTRAG
    };

    let full_prompt = format!(
        "{}\n\nWICHTIGE LAYOUT-INFO: {}\n\nDokument Inhalt:\n{}",
        base_prompt, layout_instruction, extracted_text
    );

    let client = reqwest::Client::new();

    // Helper to check whether the `produkte` array exists and is non-empty
    let products_non_empty = |v: &Value| -> bool {
        v.get("produkte")
            .and_then(|p| p.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false)
    };

    // Helper async function to call the LLM with a prompt and parse the JSON result
    async fn call_llm(
        client: &reqwest::Client,
        api_key: &str,
        prompt: &str,
    ) -> Result<Value, String> {
        let body = json!({
            "model": "mistral-large-latest",
            "messages": [
                { "role": "user", "content": prompt }
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
            .ok_or("Kein Inhalt in der Antwort")?;

        let parsed: Value =
            serde_json::from_str(content_str).map_err(|e| format!("JSON Parse Fehler: {}", e))?;

        Ok(parsed)
    }

    let mut result_obj = call_llm(&client, &api_key, &full_prompt).await?;

    if !products_non_empty(&result_obj) {
        if used_ocr {
            sleep(Duration::from_millis(2000)).await;
            return Ok(result_obj);
        }

        let sidecar_layout = app
            .shell()
            .sidecar("pdftotext")
            .map_err(|e| format!("Sidecar Konfiguration Fehler: {}", e))?
            .args(&["-enc", "UTF-8", "-layout", &path, "-"]);

        let output_layout = sidecar_layout
            .output()
            .await
            .map_err(|e| format!("Konnte Sidecar nicht ausführen: {}", e))?;

        if output_layout.status.success() {
            extracted_text = String::from_utf8_lossy(&output_layout.stdout).to_string();
        }

        println!("pdftotext -layout: \n{}", path);

        layout_instruction = "THE LAYOUT IS LAYOUT. Preserve original PDF layout.".to_string();

        let retry_prompt = format!(
            "{}\n\nWICHTIGE LAYOUT-INFO: {}\n\nDokument Inhalt:\n{}",
            base_prompt, layout_instruction, extracted_text
        );

        match call_llm(&client, &api_key, &retry_prompt).await {
            Ok(parsed) => {
                result_obj = parsed;
                if products_non_empty(&result_obj) {
                    sleep(Duration::from_millis(1000)).await;
                    return Ok(result_obj);
                }
            }
            Err(e) => return Err(e),
        }

        if !used_ocr {
            let file_bytes =
                fs::read(&path).map_err(|e| format!("Konnte Datei nicht lesen: {}", e))?;

            let b64_doc = general_purpose::STANDARD.encode(file_bytes);

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

            println!("OCR: \n{}", extracted_text);

            layout_instruction =
                "THE LAYOUT IS MARKDOWN. Tables are marked with pipes '|'. Use this structure."
                    .to_string();

            let retry_prompt = format!(
                "{}\n\nWICHTIGE LAYOUT-INFO: {}\n\nDokument Inhalt:\n{}",
                base_prompt, layout_instruction, extracted_text
            );

            result_obj = call_llm(&client, &api_key, &retry_prompt).await?;
        }
    }

    sleep(Duration::from_millis(1000)).await;

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
