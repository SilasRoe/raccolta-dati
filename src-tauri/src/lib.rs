use base64::{engine::general_purpose, Engine as _};
use chrono::NaiveDate;
use dotenv::dotenv;
use regex::{Captures, Regex};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::time::Duration;
use tauri::{command, AppHandle};
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
    datum_rechnung: Option<String>,
    nummer_rechnung: Option<String>,
    gelieferte_menge: Option<f64>,
    anmerkungen: Option<String>,
}
struct SheetRow {
    row_idx: u32,
    supplier: String,
    date: NaiveDate,
}

fn parse_date(date_str: &str) -> Option<NaiveDate> {
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%d.%m.%Y") {
        return Some(d);
    }
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return Some(d);
    }

    if let Ok(days) = date_str.parse::<i64>() {
        let base = NaiveDate::from_ymd_opt(1899, 12, 30)?;
        return base.checked_add_signed(chrono::Duration::days(days));
    }
    None
}

fn adjust_formula(formula: &str, old_row: u32, new_row: u32) -> String {
    let re = Regex::new(r"(\d+)").unwrap();
    let old_s = old_row.to_string();
    let new_s = new_row.to_string();

    re.replace_all(formula, |caps: &Captures| {
        if &caps[0] == old_s.as_str() {
            new_s.clone()
        } else {
            caps[0].to_string()
        }
    })
    .to_string()
}

#[command]
async fn export_to_excel(
    app: tauri::AppHandle,
    mut data: Vec<ExportRow>,
) -> Result<String, String> {
    if data.is_empty() {
        return Err("Keine Daten ausgewählt.".to_string());
    }

    let file_path_opt = app
        .dialog()
        .file()
        .add_filter("Excel", &["xlsx", "xlsm"])
        .blocking_pick_file();

    let path_buf = match file_path_opt {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Ok("Abbruch durch Benutzer".to_string()),
    };
    let path = path_buf.as_path();

    if let Err(_) = OpenOptions::new().write(true).append(true).open(path) {
        return Err("Zugriff verweigert! Datei ist geöffnet.".to_string());
    }

    let mut book =
        umya_spreadsheet::reader::xlsx::read(path).map_err(|e| format!("Lesefehler: {}", e))?;

    let sheet = book
        .get_sheet_mut(&0)
        .ok_or("Kein Arbeitsblatt gefunden.".to_string())?;

    let highest_row = sheet.get_highest_row();

    let mut header_row = 1;
    let search_limit = if highest_row < 100 { highest_row } else { 100 };

    for r in 1..=search_limit {
        let cell_val = sheet.get_value((4, r));
        if cell_val.trim().eq_ignore_ascii_case("Casa Estera") {
            header_row = r;
            break;
        }
    }

    let start_data_row = header_row + 1;

    let mut existing_rows: Vec<SheetRow> = Vec::with_capacity(highest_row as usize);

    if highest_row >= start_data_row {
        for r in start_data_row..=highest_row {
            let s_val = sheet.get_value((4, r));
            let d_val = sheet.get_value((1, r));

            existing_rows.push(SheetRow {
                row_idx: r,
                supplier: s_val.to_lowercase(),
                date: parse_date(&d_val).unwrap_or(NaiveDate::from_ymd_opt(2200, 1, 1).unwrap()),
            });
        }
    }

    let mut insertions: BTreeMap<u32, Vec<ExportRow>> = BTreeMap::new();

    data.sort_by(|a, b| {
        let date_a = parse_date(&a.datum_auftrag.clone().unwrap_or_default());
        let date_b = parse_date(&b.datum_auftrag.clone().unwrap_or_default());
        date_a.cmp(&date_b)
    });

    let data_len = data.len();

    for new_row in data {
        let target_supplier = new_row.lieferant.clone().unwrap_or_default().to_lowercase();
        let target_date = parse_date(&new_row.datum_auftrag.clone().unwrap_or_default())
            .unwrap_or(NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());

        let mut insert_at = highest_row + 1;
        if insert_at < start_data_row {
            insert_at = start_data_row;
        }

        let mut found_supplier_block = false;

        for ex in &existing_rows {
            if ex.supplier == target_supplier {
                found_supplier_block = true;
                if ex.date > target_date {
                    insert_at = ex.row_idx;
                    break;
                }
            } else if found_supplier_block {
                insert_at = ex.row_idx;
                break;
            } else if ex.supplier > target_supplier {
                insert_at = ex.row_idx;
                break;
            }
        }
        insertions.entry(insert_at).or_default().push(new_row);
    }

    for (row_idx, rows_to_insert) in insertions.iter().rev() {
        let start_row = *row_idx;
        let count = rows_to_insert.len() as u32;

        sheet.insert_new_row(&start_row, &count);

        let (template_row, formula_source_row) = if start_row > start_data_row {
            (start_row - 1, start_row - 1)
        } else {
            (start_row + count, start_row + count)
        };

        let template_formula = {
            match sheet.get_cell((13, template_row)) {
                Some(c) => c.get_formula().to_string(),
                None => String::new(),
            }
        };

        let mut column_styles = Vec::with_capacity(13);
        for col in 1..=13 {
            column_styles.push(sheet.get_style((col, template_row)).clone());
        }

        for (i, row_data) in rows_to_insert.iter().enumerate() {
            let r = start_row + i as u32;

            if let Some(v) = &row_data.datum_auftrag {
                sheet.get_cell_mut((1, r)).set_value(v);
            }
            if let Some(v) = &row_data.nummer_auftrag {
                sheet.get_cell_mut((2, r)).set_value(v);
            }
            if let Some(v) = &row_data.kunde {
                sheet.get_cell_mut((3, r)).set_value(v);
            }
            if let Some(v) = &row_data.lieferant {
                sheet.get_cell_mut((4, r)).set_value(v);
            }
            if let Some(v) = &row_data.produkt {
                sheet.get_cell_mut((5, r)).set_value(v);
            }
            if let Some(v) = row_data.menge {
                sheet.get_cell_mut((6, r)).set_value_number(v);
            }
            if let Some(v) = &row_data.waehrung {
                sheet.get_cell_mut((7, r)).set_value(v);
            }
            if let Some(v) = row_data.preis {
                sheet.get_cell_mut((8, r)).set_value_number(v);
            }
            if let Some(v) = &row_data.datum_rechnung {
                sheet.get_cell_mut((10, r)).set_value(v);
            }
            if let Some(v) = &row_data.nummer_rechnung {
                sheet.get_cell_mut((11, r)).set_value(v);
            }
            if let Some(v) = row_data.gelieferte_menge {
                sheet.get_cell_mut((12, r)).set_value_number(v);
            }
            if let Some(v) = &row_data.anmerkungen {
                sheet.get_cell_mut((18, r)).set_value(v);
            }

            for col in 1..=13 {
                if let Some(style) = column_styles.get((col - 1) as usize) {
                    sheet.set_style((col, r), style.clone());
                }
            }

            if !template_formula.is_empty() {
                let new_formula = adjust_formula(&template_formula, formula_source_row, r);
                sheet.get_cell_mut((13, r)).set_formula(new_formula);
            }
        }
    }

    let _ = umya_spreadsheet::writer::xlsx::write(&book, path)
        .map_err(|e| format!("Speicherfehler: {}", e))?;

    Ok(format!("{} Datensätze erfolgreich einsortiert.", data_len))
}

async fn run_sidecar(app: &AppHandle, path: &str, use_layout: bool) -> Result<String, String> {
    let mut args = vec!["-enc", "UTF-8"];
    if use_layout {
        args.push("-layout");
    }
    args.push(path);
    args.push("-");

    let sidecar_command = app
        .shell()
        .sidecar("pdftotext")
        .map_err(|e| format!("Sidecar Konfiguration Fehler: {}", e))?
        .args(&args);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("Konnte Sidecar nicht ausführen: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!("Sidecar Exit Code: {:?}", output.status.code()))
    }
}

async fn call_llm(client: &reqwest::Client, api_key: &str, prompt: &str) -> Result<Value, String> {
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
        .map_err(|e| format!("API Request Fehler: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API Status Fehler: {}", res.status()));
    }

    let json_res: Value = res
        .json()
        .await
        .map_err(|e| format!("JSON Fehler: {}", e))?;

    let content_str = json_res["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Kein Inhalt in der Antwort")?;

    serde_json::from_str(content_str).map_err(|e| format!("JSON Parse Fehler: {}", e))
}

async fn perform_single_ocr(
    client: &reqwest::Client,
    api_key: &str,
    path: &str,
) -> Result<String, String> {
    let file_bytes = fs::read(path).map_err(|e| format!("Konnte Datei nicht lesen: {}", e))?;
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
        return Err(format!("Mistral OCR Status: {}", ocr_res.status()));
    }

    let ocr_json: Value = ocr_res.json().await.map_err(|e| e.to_string())?;

    if let Some(pages) = ocr_json.get("pages").and_then(|p| p.as_array()) {
        let text = pages
            .iter()
            .filter_map(|p| p.get("markdown").and_then(|m| m.as_str()))
            .collect::<Vec<&str>>()
            .join("\n\n");

        if text.trim().is_empty() {
            return Err("OCR Ergebnis war leer".to_string());
        }
        Ok(text)
    } else {
        Err("Keine Seiten im OCR Ergebnis gefunden".to_string())
    }
}

async fn perform_ocr_with_retry(
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
                println!("OCR Versuch {} fehlgeschlagen: {}", attempt, last_error);
                if attempt < max_retries {
                    sleep(Duration::from_millis(1500)).await;
                }
            }
        }
    }
    Err(format!(
        "OCR fehlgeschlagen nach {} Versuchen. Letzter Fehler: {}",
        max_retries, last_error
    ))
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

    let client = reqwest::Client::new();

    let mut extracted_text = run_sidecar(&app, &path, false).await.unwrap_or_default();
    let mut layout_instruction = "THE LAYOUT IS ‘WHITESPACE’. Columns are separated only by spaces. There are no lines. Visualize the columns.".to_string();
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
                    "Kritischer Fehler: Weder PDF-Text noch OCR möglich. ({})",
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
        "{}\n\nWICHTIGE LAYOUT-INFO: {}\n\nDokument Inhalt:\n{}",
        base_prompt, layout_instruction, extracted_text
    );

    let mut result_obj = call_llm(&client, &api_key, &full_prompt).await?;

    if !products_non_empty(&result_obj) {
        if !used_ocr {
            if let Ok(layout_text) = run_sidecar(&app, &path, true).await {
                if layout_text.trim().len() > 50 {
                    let retry_prompt = format!(
                        "{}\n\nWICHTIGE LAYOUT-INFO: THE LAYOUT IS LAYOUT. Preserve original PDF layout.\n\nDokument Inhalt:\n{}",
                        base_prompt, layout_text
                    );

                    if let Ok(parsed) = call_llm(&client, &api_key, &retry_prompt).await {
                        if products_non_empty(&parsed) {
                            return Ok(parsed);
                        }
                    }
                }
            }

            match perform_ocr_with_retry(&client, &api_key, &path).await {
                Ok(ocr_text) => {
                    let retry_prompt = format!(
                        "{}\n\nWICHTIGE LAYOUT-INFO: THE LAYOUT IS MARKDOWN. Tables are marked with pipes '|'. Use this structure.\n\nDokument Inhalt:\n{}",
                        base_prompt, ocr_text
                    );
                    result_obj = call_llm(&client, &api_key, &retry_prompt).await?;
                }
                Err(e) => {
                    println!("Fallback OCR fehlgeschlagen: {}", e);
                }
            }
        } else {
            sleep(Duration::from_millis(1500)).await;
        }
    }

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
