use base64::{engine::general_purpose, Engine as _};
use dotenv::dotenv;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::time::Duration;
use tauri::command;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

const PROMPT_AUFTRAG: &str = include_str!("../../src/prompts/PromptAuftrag.txt");
const PROMPT_RECHNUNG: &str = include_str!("../../src/prompts/PromptRechnung.txt");

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRow {
    datum_auftrag: Option<String>,
    nummer_auftrag: Option<String>,
    kunde: Option<String>,
    lieferant: Option<String>,
    produkt: Option<String>,
    menge: Option<f64>,
    waehrung: Option<String>,
    preis: Option<f64>,
    leer: Option<String>,
    datum_rechnung: Option<String>,
    nummer_rechnung: Option<String>,
    gelieferte_menge: Option<f64>,
    anmerkungen: Option<String>,
}

#[command]
async fn export_to_excel(app: tauri::AppHandle, data: Vec<ExportRow>) -> Result<String, String> {
    if data.is_empty() {
        return Err("Nessun dato selezionato.".to_string());
    }

    let file_path_opt = app
        .dialog()
        .file()
        .add_filter("Excel", &["xlsx", "xlsm"])
        .blocking_pick_file();

    let path_buf = match file_path_opt {
        Some(p) => p
            .into_path()
            .map_err(|e| format!("Errore di percorso: {}", e))?,
        None => return Ok("Interruzione da parte dell'utente".to_string()),
    };
    let path = path_buf.as_path();

    let mut book = if path.exists() {
        umya_spreadsheet::reader::xlsx::read(path).map_err(|e| {
            format!(
                "Errore durante la lettura del file, il file è aperto?: {}",
                e
            )
        })?
    } else {
        umya_spreadsheet::new_file()
    };

    let sheet = book
        .get_sheet_mut(&0)
        .ok_or("Non sono riuscito a trovare il primo foglio di lavoro.".to_string())?;

    let mut next_row = 4;

    if next_row <= 1 {
        let headers: [&str; 13] = [
            "Datum",
            "Auftrag Nr.",
            "Kunde",
            "Lieferant",
            "Produkt",
            "Menge",
            "Währung",
            "Preis",
            "",
            "Rechnung Datum",
            "Rechnung Nr.",
            "Gelief. Menge",
            "Anmerkungen",
        ];
        for (col, text) in headers.iter().enumerate() {
            sheet.get_cell_mut(((col + 1) as u32, 1)).set_value(*text);
        }
        next_row = 2;
    }

    for row_data in data {
        if let Some(v) = row_data.datum_auftrag {
            sheet.get_cell_mut((1, next_row)).set_value(v);
        }
        if let Some(v) = row_data.nummer_auftrag {
            sheet.get_cell_mut((2, next_row)).set_value(v);
        }
        if let Some(v) = row_data.kunde {
            sheet.get_cell_mut((3, next_row)).set_value(v);
        }
        if let Some(v) = row_data.lieferant {
            sheet.get_cell_mut((4, next_row)).set_value(v);
        }
        if let Some(v) = row_data.produkt {
            sheet.get_cell_mut((5, next_row)).set_value(v);
        }
        if let Some(v) = row_data.menge {
            sheet.get_cell_mut((6, next_row)).set_value_number(v);
        }
        if let Some(v) = row_data.waehrung {
            sheet.get_cell_mut((7, next_row)).set_value(v);
        }
        if let Some(v) = row_data.preis {
            sheet.get_cell_mut((8, next_row)).set_value_number(v);
        }
        if let Some(v) = row_data.leer {
            sheet.get_cell_mut((9, next_row)).set_value(v);
        }
        if let Some(v) = row_data.datum_rechnung {
            sheet.get_cell_mut((10, next_row)).set_value(v);
        }
        if let Some(v) = row_data.nummer_rechnung {
            sheet.get_cell_mut((11, next_row)).set_value(v);
        }
        if let Some(v) = row_data.gelieferte_menge {
            sheet.get_cell_mut((12, next_row)).set_value_number(v);
        }
        if let Some(v) = row_data.anmerkungen {
            sheet.get_cell_mut((13, next_row)).set_value(v);
        }

        next_row += 1;
    }

    let _ = umya_spreadsheet::writer::xlsx::write(&book, path)
        .map_err(|e| format!("Errore durante il salvataggio: {}", e))?;

    Ok(format!("Record aggiunti con successo."))
}

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
        .invoke_handler(tauri::generate_handler![analyze_document, export_to_excel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
