use base64::{engine::general_purpose, Engine as _};
use chrono::NaiveDate;
use dotenv::dotenv;
use keyring::Entry;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;
use tauri::{command, AppHandle};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
use tokio::time::sleep;

const PROMPT_AUFTRAG: &str = include_str!("../../src/prompts/PromptAuftrag.txt");
const PROMPT_RECHNUNG: &str = include_str!("../../src/prompts/PromptRechnung.txt");

#[derive(serde::Deserialize, serde::Serialize, Clone)]
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

#[command]
async fn get_corrections(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let store = app
        .store("corrections.json")
        .map_err(|e| format!("Store errore: {}", e))?;

    match store.get("product_corrections") {
        Some(val) => serde_json::from_value(val).map_err(|e| format!("Parse errore: {}", e)),
        None => Ok(HashMap::new()),
    }
}

#[command]
async fn remove_correction(app: tauri::AppHandle, wrong: String) -> Result<(), String> {
    let store = app
        .store("corrections.json")
        .map_err(|e| format!("Store errore: {}", e))?;

    let mut corrections: HashMap<String, String> = match store.get("product_corrections") {
        Some(val) => serde_json::from_value(val).unwrap_or_default(),
        None => HashMap::new(),
    };

    if corrections.remove(&wrong).is_some() {
        store.set("product_corrections", json!(corrections));
        store
            .save()
            .map_err(|e| format!("Errore di memoria: {}", e))?;
    }

    Ok(())
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
    let pattern = format!(r"([A-Z]){}\b", old_row);
    let re = Regex::new(&pattern).unwrap();
    re.replace_all(formula, format!("${{1}}{}", new_row))
        .to_string()
}

const KEYRING_SERVICE: &str = "com.silas.maggus";
const KEYRING_USER: &str = "mistral_api_key";

#[command]
async fn save_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let key_trimmed = key.trim();
    let keyring_result = Entry::new(KEYRING_SERVICE, KEYRING_USER);

    match keyring_result {
        Ok(entry) => {
            if key_trimmed.is_empty() {
                let _ = entry.delete_credential();
            } else {
                if let Err(e) = entry.set_password(key_trimmed) {
                    println!(
                        "⚠️ Errore di scrittura del portachiavi: {}. Utilizza il fallback...",
                        e
                    );
                    return save_to_json_fallback(&app, key_trimmed);
                }
            }
        }
        Err(e) => {
            println!(
                "⚠️ Portachiavi non disponibile: {}. Utilizza fallback...",
                e
            );
            return save_to_json_fallback(&app, key_trimmed);
        }
    }

    let _ = save_to_json_fallback(&app, "");

    Ok(())
}

fn save_to_json_fallback(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;

    if key.is_empty() {
        store.delete("apiKey");
    } else {
        store.set("apiKey", json!(key));
    }

    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
async fn get_api_key() -> Result<String, String> {
    let entry = match Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(e) => e,
        Err(_) => return Ok("".to_string()),
    };

    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(_) => Ok("".to_string()),
    }
}

#[command]
async fn export_to_excel(
    app: tauri::AppHandle,
    data: Vec<ExportRow>,
    file_path: Option<String>,
) -> Result<String, String> {
    if data.is_empty() {
        return Err("Nessun dato selezionato.".to_string());
    }

    let path_buf = if let Some(p) = file_path {
        PathBuf::from(p)
    } else {
        let file_path_opt = app
            .dialog()
            .file()
            .add_filter("Excel", &["xlsx", "xlsm"])
            .blocking_pick_file();

        match file_path_opt {
            Some(p) => p.into_path().map_err(|e| e.to_string())?,
            None => return Ok("Interruzione da parte dell'utente".to_string()),
        }
    };
    let path = path_buf.as_path();

    if let Err(_) = OpenOptions::new().write(true).append(true).open(path) {
        return Err("Accesso negato! Il file è aperto.".to_string());
    }

    let mut book = umya_spreadsheet::reader::xlsx::read(path)
        .map_err(|e| format!("Errore di lettura: {}", e))?;

    let sheet = book
        .get_sheet_mut(&0)
        .ok_or("Nessun foglio di lavoro trovato.".to_string())?;

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

    let mut index_map: HashMap<(String, String), u32> = HashMap::new();
    let mut existing_rows_for_sorting: Vec<SheetRow> = Vec::with_capacity(highest_row as usize);

    if highest_row >= start_data_row {
        for r in start_data_row..=highest_row {
            let s_val = sheet.get_value((4, r));
            let d_val = sheet.get_value((1, r));

            existing_rows_for_sorting.push(SheetRow {
                row_idx: r,
                supplier: s_val.to_lowercase(),
                date: parse_date(&d_val).unwrap_or(NaiveDate::from_ymd_opt(2200, 1, 1).unwrap()),
            });

            let auftrag_nr = sheet.get_value((2, r)).to_string().trim().to_lowercase();
            let produkt = sheet.get_value((5, r)).to_string().trim().to_lowercase();

            if !auftrag_nr.is_empty() && !produkt.is_empty() {
                index_map.insert((auftrag_nr, produkt), r);
            }
        }
    }

    let mut merged_input_map: HashMap<(String, String), ExportRow> = HashMap::new();
    let mut unmatchable_rows: Vec<ExportRow> = Vec::new();

    for row in data {
        if let (Some(nr), Some(prod)) = (&row.nummer_auftrag, &row.produkt) {
            let key = (nr.trim().to_lowercase(), prod.trim().to_lowercase());

            if let Some(existing) = merged_input_map.get_mut(&key) {
                if existing.datum_rechnung.is_none() {
                    existing.datum_rechnung = row.datum_rechnung;
                }
                if existing.nummer_rechnung.is_none() {
                    existing.nummer_rechnung = row.nummer_rechnung;
                }
                if existing.gelieferte_menge.is_none() {
                    existing.gelieferte_menge = row.gelieferte_menge;
                }
                if existing.preis.is_none() {
                    existing.preis = row.preis;
                }
                if existing.menge.is_none() {
                    existing.menge = row.menge;
                }
            } else {
                merged_input_map.insert(key, row);
            }
        } else {
            unmatchable_rows.push(row);
        }
    }

    let mut processing_queue: Vec<ExportRow> = merged_input_map.into_values().collect();
    processing_queue.append(&mut unmatchable_rows);

    let total_ops = processing_queue.len();
    let mut current_progress = 0;

    let mut rows_to_insert: Vec<ExportRow> = Vec::new();
    let mut updated_count = 0;

    for row in processing_queue {
        let key = (
            row.nummer_auftrag
                .clone()
                .unwrap_or_default()
                .trim()
                .to_lowercase(),
            row.produkt
                .clone()
                .unwrap_or_default()
                .trim()
                .to_lowercase(),
        );

        if let Some(&row_idx) = index_map.get(&key) {
            if let Some(v) = &row.datum_rechnung {
                sheet.get_cell_mut((10, row_idx)).set_value(v);
            }
            if let Some(v) = &row.nummer_rechnung {
                sheet.get_cell_mut((11, row_idx)).set_value(v);
            }
            if let Some(v) = row.gelieferte_menge {
                sheet.get_cell_mut((12, row_idx)).set_value_number(v);
            }
            if let Some(v) = &row.anmerkungen {
                let existing_note = sheet.get_value((18, row_idx));
                if existing_note.is_empty() {
                    sheet.get_cell_mut((18, row_idx)).set_value(v);
                }
            }
            updated_count += 1;

            current_progress += 1;
            if current_progress % 10 == 0 || current_progress == total_ops {
                let _ = app.emit(
                    "excel-progress",
                    json!({ "current": current_progress, "total": total_ops }),
                );
            }
        } else {
            rows_to_insert.push(row);
        }
    }

    if !rows_to_insert.is_empty() {
        rows_to_insert.sort_by(|a, b| {
            let date_a = parse_date(&a.datum_auftrag.clone().unwrap_or_default());
            let date_b = parse_date(&b.datum_auftrag.clone().unwrap_or_default());
            date_a.cmp(&date_b)
        });

        let mut insertions: BTreeMap<u32, Vec<ExportRow>> = BTreeMap::new();

        for new_row in rows_to_insert.iter() {
            let target_supplier = new_row.lieferant.clone().unwrap_or_default().to_lowercase();
            let target_date = parse_date(&new_row.datum_auftrag.clone().unwrap_or_default())
                .unwrap_or(NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());

            let mut insert_at = sheet.get_highest_row() + 1;
            if insert_at < start_data_row {
                insert_at = start_data_row;
            }

            let mut found_supplier_block = false;
            for ex in &existing_rows_for_sorting {
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
            insertions
                .entry(insert_at)
                .or_default()
                .push(new_row.clone());
        }

        for (row_idx, batch) in insertions.iter().rev() {
            let start_row = *row_idx;
            let count = batch.len() as u32;

            sheet.insert_new_row(&start_row, &count);

            let (template_row, formula_source_row) = if start_row > start_data_row {
                (start_row - 1, start_row - 1)
            } else {
                (start_row + count, start_row + count)
            };

            let template_formula = match sheet.get_cell((13, template_row)) {
                Some(c) => c.get_formula().to_string(),
                None => String::new(),
            };

            let mut column_styles = Vec::with_capacity(18);
            for col in 1..=18 {
                column_styles.push(sheet.get_style((col, template_row)).clone());
            }

            for (i, row_data) in batch.iter().enumerate() {
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

                for col in 1..=18 {
                    if let Some(style) = column_styles.get((col - 1) as usize) {
                        let mut s = style.clone();

                        if col == 1 || col == 10 {
                            s.get_alignment_mut()
                                .set_horizontal(umya_spreadsheet::HorizontalAlignmentValues::Right);
                        }

                        sheet.set_style((col, r), s);
                    }
                }

                if !template_formula.is_empty() {
                    let new_formula = adjust_formula(&template_formula, formula_source_row, r);
                    sheet.get_cell_mut((13, r)).set_formula(new_formula);
                }

                current_progress += 1;
                if current_progress % 10 == 0 || current_progress == total_ops {
                    let _ = app.emit(
                        "excel-progress",
                        json!({ "current": current_progress, "total": total_ops }),
                    );
                }
            }
        }
    }

    let _ = app.emit(
        "excel-progress",
        json!({ "current": total_ops, "total": total_ops }),
    );

    let _ = umya_spreadsheet::writer::xlsx::write(&book, path)
        .map_err(|e| format!("Errore di memoria: {}", e))?;

    let inserted_count = rows_to_insert.len();
    Ok(format!(
        "Finito: {} aggiornati, {} nuovi inseriti.",
        updated_count, inserted_count
    ))
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

async fn perform_single_ocr(
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
async fn analyze_document(
    app: tauri::AppHandle,
    path: String,
    doc_type: String,
) -> Result<Value, String> {
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
                            result_obj = parsed;
                        }
                    }
                }
            }

            if !products_non_empty(&result_obj) {
                match perform_ocr_with_retry(&client, &api_key, &path).await {
                    Ok(ocr_text) => {
                        let retry_prompt = format!(
                            "{}\n\nWICHTIGE LAYOUT-INFO: THE LAYOUT IS MARKDOWN. Tables are marked with pipes '|'. Use this structure.\n\nDokument Inhalt:\n{}",
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

#[command]
async fn learn_correction(
    app: tauri::AppHandle,
    wrong: String,
    correct: String,
) -> Result<(), String> {
    if wrong.trim().is_empty() || correct.trim().is_empty() || wrong == correct {
        return Ok(());
    }

    let store = app
        .store("corrections.json")
        .map_err(|e| format!("Errore di memoria: {}", e))?;

    let mut corrections: HashMap<String, String> = match store.get("product_corrections") {
        Some(val) => serde_json::from_value(val).unwrap_or_default(),
        None => HashMap::new(),
    };

    corrections.insert(wrong.trim().to_string(), correct.trim().to_string());

    store.set("product_corrections", json!(corrections));
    store
        .save()
        .map_err(|e| format!("Errore di memoria: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            analyze_document,
            export_to_excel,
            save_api_key,
            get_api_key,
            learn_correction,
            get_corrections,
            remove_correction
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
