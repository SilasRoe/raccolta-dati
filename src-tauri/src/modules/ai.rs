use crate::modules::config::get_api_key;
use crate::modules::utils::format_to_uppercase;

use base64::{engine::general_purpose, Engine as _};
use dotenv::dotenv;
use keepawake;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::time::Duration;
use tauri::{command, AppHandle};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
use tokio::time::sleep;

const PROMPT_AUFTRAG: &str = include_str!("../../../src/prompts/PromptAuftrag.txt");
const PROMPT_RECHNUNG: &str = include_str!("../../../src/prompts/PromptRechnung.txt");

pub async fn run_sidecar(app: &AppHandle, path: &str, use_layout: bool) -> Result<String, String> {
    let mut args = vec!["-enc", "UTF-8"];
    if use_layout {
        args.push("-layout");
    }
    args.push(path);
    args.push("-");

    let sidecar_command = app
        .shell()
        .sidecar("pdftotext")
        .map_err(|e| format!("Errore di configurazione del sidecar: {}", e))?
        .args(&args);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("Impossibile eseguire Sidecar: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!("Sidecar Exit Code: {:?}", output.status.code()))
    }
}

pub async fn call_llm(
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
        .map_err(|e| format!("Errore richiesta API: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Errore di stato API: {}", res.status()));
    }

    let json_res: Value = res
        .json()
        .await
        .map_err(|e| format!("JSON Fehler: {}", e))?;

    let content_str = json_res["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Nessun contenuto nella risposta")?;

    serde_json::from_str(content_str).map_err(|e| format!("Errore di analisi JSON: {}", e))
}

pub async fn perform_single_ocr(
    client: &reqwest::Client,
    api_key: &str,
    path: &str,
) -> Result<String, String> {
    let file_bytes = fs::read(path).map_err(|e| format!("Impossibile leggere il file: {}", e))?;
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
        .map_err(|e| format!("Richiesta OCR non riuscita: {}", e))?;

    if !ocr_res.status().is_success() {
        return Err(format!("Stato Mistral OCR: {}", ocr_res.status()));
    }

    let ocr_json: Value = ocr_res.json().await.map_err(|e| e.to_string())?;

    if let Some(pages) = ocr_json.get("pages").and_then(|p| p.as_array()) {
        let text = pages
            .iter()
            .filter_map(|p| p.get("markdown").and_then(|m| m.as_str()))
            .collect::<Vec<&str>>()
            .join("\n\n");

        if text.trim().is_empty() {
            return Err("Il risultato OCR era vuoto".to_string());
        }
        Ok(text)
    } else {
        Err("Nessuna pagina nel risultato OCR".to_string())
    }
}

pub async fn perform_ocr_with_retry(
    client: &reqwest::Client,
    api_key: &str,
    path: &str,
) -> Result<String, String> {
    let max_retries = 2;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        match perform_single_ocr(client, api_key, path).await {
            Ok(text) => return Ok(text),
            Err(e) => {
                last_error = e;
                println!("Prova OCR {} fallito: {}", attempt, last_error);
                if attempt < max_retries {
                    sleep(Duration::from_millis(1500)).await;
                }
            }
        }
    }
    Err(format!(
        "OCR fallito dopo {} tentativi. Ultimo errore: {}",
        max_retries, last_error
    ))
}

#[command]
pub async fn analyze_document(
    app: tauri::AppHandle,
    path: String,
    doc_type: String,
) -> Result<Value, String> {
    let _guard = keepawake::Builder::default()
        .display(false)
        .idle(true)
        .sleep(true)
        .create()
        .map_err(|e| format!("Impossibile attivare la gestione dell'alimentazione: {}", e))?;

    dotenv().ok();
    let api_key = get_api_key().await?;

    if api_key.trim().is_empty() {
        return Err("La chiave API è vuota. Inserirla nelle impostazioni.".to_string());
    }

    let client = reqwest::Client::new();

    let mut extracted_text = run_sidecar(&app, &path, false).await.unwrap_or_default();
    let mut layout_instruction = "THE LAYOUT IS 'WHITESPACE'. Columns are separated only by spaces. There are no lines. Visualize the columns.".to_string();
    let mut used_ocr = false;

    if extracted_text.trim().len() < 50 {
        match perform_ocr_with_retry(&client, &api_key, &path).await {
            Ok(text) => {
                extracted_text = text;
                used_ocr = true;
                layout_instruction =
                    "THE LAYOUT IS MARKDOWN. Tables are marked with pipes '|'. Use this structure."
                        .to_string();
            }
            Err(e) => {
                return Err(format!(
                    "Errore critico: impossibile convertire il testo in PDF o eseguire l'OCR. ({})",
                    e
                ));
            }
        }
    }

    let base_prompt = if doc_type == "rechnung" {
        PROMPT_RECHNUNG
    } else {
        PROMPT_AUFTRAG
    };

    let products_non_empty = |v: &Value| -> bool {
        v.get("produkte")
            .and_then(|p| p.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false)
    };

    let full_prompt = format!(
        "{}\n\nIMPORTANT LAYOUT-INFORMATION: {}\n\nContent document:\n{}",
        base_prompt, layout_instruction, extracted_text
    );

    let mut result_obj = call_llm(&client, &api_key, &full_prompt).await?;
    format_to_uppercase(&mut result_obj);

    if !products_non_empty(&result_obj) {
        if !used_ocr {
            if let Ok(layout_text) = run_sidecar(&app, &path, true).await {
                if layout_text.trim().len() > 50 {
                    let retry_prompt = format!(
                        "{}\n\nIMPORTANT LAYOUT-INFORMATION: THE LAYOUT IS LAYOUT. Preserve original PDF layout.\n\nContent document:\n{}",
                        base_prompt, layout_text
                    );

                    if let Ok(parsed) = call_llm(&client, &api_key, &retry_prompt).await {
                        if products_non_empty(&parsed) {
                            result_obj = parsed;
                        }
                    }
                }
            }

            if !products_non_empty(&result_obj) {
                match perform_ocr_with_retry(&client, &api_key, &path).await {
                    Ok(ocr_text) => {
                        let retry_prompt = format!(
                            "{}\n\nIMPORTANT LAYOUT-INFORMATION: THE LAYOUT IS MARKDOWN. Tables are marked with pipes '|'. Use this structure.\n\nContent document:\n{}",
                            base_prompt, ocr_text
                        );
                        if let Ok(parsed) = call_llm(&client, &api_key, &retry_prompt).await {
                            result_obj = parsed;
                        }
                    }
                    Err(e) => {
                        println!("Fallback OCR non riuscito: {}", e);
                    }
                }
            }
        } else {
            sleep(Duration::from_millis(1500)).await;
        }
    }

    if let Ok(store) = app.store("corrections.json") {
        if let Some(val) = store.get("product_corrections") {
            if let Ok(corrections) = serde_json::from_value::<HashMap<String, String>>(val) {
                if let Some(products) = result_obj
                    .get_mut("produkte")
                    .and_then(|p| p.as_array_mut())
                {
                    for prod in products {
                        if let Some(name_val) = prod.get_mut("produkt") {
                            if let Some(name) = name_val.as_str() {
                                if let Some(correction) = corrections.get(name) {
                                    *name_val = json!(correction);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(result_obj)
}
