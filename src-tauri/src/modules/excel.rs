use crate::modules::utils::{adjust_formula, parse_date, token_similarity};

use chrono::NaiveDate;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::fs::OpenOptions;
use std::io::Read;
use std::path::PathBuf;
use tauri::command;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use zip::ZipArchive;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportRow {
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
    order_number: String,
    date: NaiveDate,
}

#[command]
pub async fn check_excel_access(path: String) -> Result<bool, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("Il file non esiste.".to_string());
    }

    match OpenOptions::new().write(true).open(&path_buf) {
        Ok(_) => Ok(true),
        Err(e) => Err(format!(
            "Accesso negato! Il file è aperto o protetto? ({})",
            e
        )),
    }
}

fn is_1904_system(path: &std::path::Path) -> bool {
    if let Ok(file) = std::fs::File::open(path) {
        if let Ok(mut archive) = ZipArchive::new(file) {
            if let Ok(mut xml_file) = archive.by_name("xl/workbook.xml") {
                let mut contents = String::new();
                if xml_file.read_to_string(&mut contents).is_ok() {
                    return contents.contains("date1904=\"1\"")
                        || contents.contains("date1904=\"true\"");
                }
            }
        }
    }
    false
}

#[command]
pub async fn export_to_excel(
    app: tauri::AppHandle,
    mut data: Vec<ExportRow>,
    file_path: Option<String>,
) -> Result<String, String> {
    if data.is_empty() {
        return Err("Nessun dato selezionato.".to_string());
    }

    data.sort_by(|a, b| {
        let a_is_invoice = a.gelieferte_menge.is_some();
        let b_is_invoice = b.gelieferte_menge.is_some();
        a_is_invoice.cmp(&b_is_invoice)
    });

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

    if let Err(_) = OpenOptions::new().write(true).open(path) {
        return Err("Accesso negato! Il file è aperto.".to_string());
    }

    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let backup_path = path.with_file_name(format!("{}.bak", file_name));

    if let Err(e) = fs::copy(path, &backup_path) {
        println!("Avviso: impossibile creare il backup: {}", e);
    }

    let is_1904 = is_1904_system(path);
    if is_1904 {
        println!("INFO: Datei verwendet 1904-Datumssystem. Daten werden migriert.");
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

    if is_1904 && highest_row >= start_data_row {
        for r in start_data_row..=highest_row {
            for col in [1, 10, 17] {
                let cell = sheet.get_cell_mut((col, r));
                let val_str = cell.get_value().to_string();
                if let Ok(val_num) = val_str.parse::<f64>() {
                    if val_num > 30000.0 {
                        cell.set_value_number(val_num + 1462.0);
                    }
                }
            }
        }
    }

    struct ExcelCandidate {
        row_idx: u32,
        product_norm: String,
        qty: f64,
        price: f64,
    }

    let mut order_map: HashMap<String, Vec<ExcelCandidate>> = HashMap::new();
    let mut existing_rows_for_sorting: Vec<SheetRow> = Vec::with_capacity(highest_row as usize);

    if highest_row >= start_data_row {
        for r in start_data_row..=highest_row {
            let s_val = sheet.get_value((4, r)).to_lowercase();
            let d_val = sheet.get_value((1, r));
            let o_val = sheet.get_value((2, r)).to_string().trim().to_lowercase();
            let p_name = sheet.get_value((5, r)).to_string();

            let qty_val = sheet.get_value((6, r)).parse::<f64>().unwrap_or(0.0);
            let price_val = sheet.get_value((8, r)).parse::<f64>().unwrap_or(0.0);

            existing_rows_for_sorting.push(SheetRow {
                row_idx: r,
                supplier: s_val,
                order_number: o_val.clone(),
                date: parse_date(&d_val).unwrap_or(NaiveDate::from_ymd_opt(2200, 1, 1).unwrap()),
            });

            if !o_val.is_empty() {
                order_map.entry(o_val).or_default().push(ExcelCandidate {
                    row_idx: r,
                    product_norm: p_name,
                    qty: qty_val,
                    price: price_val,
                });
            }
        }
    }

    let mut rows_to_insert: Vec<ExportRow> = Vec::new();
    let mut updated_count = 0;

    let total_ops = data.len();
    let mut current_progress = 0;

    for row in data {
        let order_nr = row
            .nummer_auftrag
            .clone()
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let prod_name = row.produkt.clone().unwrap_or_default();

        let mut best_match_excel: Option<u32> = None;
        let mut best_score_excel: f64 = -1.0;

        if let (Some(inv_price), Some(inv_qty)) = (row.preis, row.gelieferte_menge) {
            if let Some(candidates) = order_map.get(&order_nr) {
                for cand in candidates {
                    if (cand.price - inv_price).abs() > 0.05 {
                        continue;
                    }

                    let qty_diff_abs = (cand.qty - inv_qty).abs();
                    let qty_diff_rel = if cand.qty > 0.0 {
                        qty_diff_abs / cand.qty
                    } else {
                        1.0
                    };

                    if qty_diff_rel > 0.5 {
                        continue;
                    }

                    let name_sim = token_similarity(&prod_name, &cand.product_norm);
                    let qty_score = (1.0 - qty_diff_rel).max(0.0);
                    let total_score = (qty_score * 10.0) + (name_sim * 5.0);

                    if total_score > best_score_excel {
                        best_score_excel = total_score;
                        best_match_excel = Some(cand.row_idx);
                    }
                }
            }
        } else {
            if let Some(candidates) = order_map.get(&order_nr) {
                if let Some(exact) = candidates
                    .iter()
                    .find(|c| c.product_norm.trim().eq_ignore_ascii_case(prod_name.trim()))
                {
                    best_match_excel = Some(exact.row_idx);
                }
            }
        }
        if let Some(row_idx) = best_match_excel {
            if let Some(v) = &row.datum_auftrag {
                sheet.get_cell_mut((1, row_idx)).set_value(v);
            }
            if let Some(v) = &row.nummer_auftrag {
                sheet.get_cell_mut((2, row_idx)).set_value(v);
            }
            if let Some(v) = &row.kunde {
                sheet.get_cell_mut((3, row_idx)).set_value(v);
            }
            if let Some(v) = &row.lieferant {
                sheet.get_cell_mut((4, row_idx)).set_value(v);
            }
            if let Some(v) = &row.produkt {
                sheet.get_cell_mut((5, row_idx)).set_value(v);
            }
            if let Some(v) = row.menge {
                sheet.get_cell_mut((6, row_idx)).set_value_number(v);
            }
            if let Some(v) = &row.waehrung {
                sheet.get_cell_mut((7, row_idx)).set_value(v);
            }
            if let Some(v) = row.preis {
                sheet.get_cell_mut((8, row_idx)).set_value_number(v);
            }

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
                sheet.get_cell_mut((18, row_idx)).set_value(v);
            }

            updated_count += 1;
        } else {
            let mut found_in_pending = false;

            if let (Some(inv_price), Some(inv_qty)) = (row.preis, row.gelieferte_menge) {
                let mut best_idx_pending = None;
                let mut best_score_pending = -1.0;

                for (idx, pending) in rows_to_insert.iter().enumerate() {
                    if pending.gelieferte_menge.is_some() {
                        continue;
                    }

                    let pending_nr = pending
                        .nummer_auftrag
                        .as_deref()
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();
                    if pending_nr != order_nr {
                        continue;
                    }

                    let pending_price = pending.preis.unwrap_or(0.0);
                    if (pending_price - inv_price).abs() > 0.05 {
                        continue;
                    }

                    let pending_qty = pending.menge.unwrap_or(0.0);
                    let qty_diff_abs = (pending_qty - inv_qty).abs();
                    let qty_diff_rel = if pending_qty > 0.0 {
                        qty_diff_abs / pending_qty
                    } else {
                        1.0
                    };

                    if qty_diff_rel > 0.5 {
                        continue;
                    }

                    let pending_name = pending.produkt.as_deref().unwrap_or("");
                    let name_sim = token_similarity(&prod_name, pending_name);

                    let qty_score = (1.0 - qty_diff_rel).max(0.0);
                    let total_score = (qty_score * 10.0) + (name_sim * 5.0);

                    if total_score > best_score_pending {
                        best_score_pending = total_score;
                        best_idx_pending = Some(idx);
                    }
                }

                if let Some(idx) = best_idx_pending {
                    let target = &mut rows_to_insert[idx];
                    target.datum_rechnung = row.datum_rechnung.clone();
                    target.nummer_rechnung = row.nummer_rechnung.clone();
                    target.gelieferte_menge = Some(inv_qty);
                    if let Some(note) = &row.anmerkungen {
                        if target.anmerkungen.is_none() {
                            target.anmerkungen = Some(note.clone());
                        }
                    }
                    found_in_pending = true;
                    updated_count += 1;
                }
            }

            if !found_in_pending {
                rows_to_insert.push(row);
            }
        }

        current_progress += 1;
        if current_progress % 10 == 0 {
            let _ = app.emit(
                "excel-progress",
                json!({ "current": current_progress, "total": total_ops }),
            );
        }
    }

    if !rows_to_insert.is_empty() {
        rows_to_insert.sort_by(|a, b| {
            let res = a
                .lieferant
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b.lieferant.as_deref().unwrap_or("").to_lowercase());
            if res != std::cmp::Ordering::Equal {
                return res;
            }

            let res = a
                .nummer_auftrag
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b.nummer_auftrag.as_deref().unwrap_or("").to_lowercase());
            if res != std::cmp::Ordering::Equal {
                return res;
            }

            let date_a = parse_date(a.datum_auftrag.as_deref().unwrap_or_default());
            let date_b = parse_date(b.datum_auftrag.as_deref().unwrap_or_default());
            date_a.cmp(&date_b)
        });

        let mut insertions: BTreeMap<u32, Vec<ExportRow>> = BTreeMap::new();

        for new_row in rows_to_insert.iter() {
            let target_supplier = new_row
                .lieferant
                .as_deref()
                .unwrap_or_default()
                .to_lowercase();
            let target_order = new_row
                .nummer_auftrag
                .as_deref()
                .unwrap_or_default()
                .to_lowercase();
            let target_date = parse_date(new_row.datum_auftrag.as_deref().unwrap_or_default())
                .unwrap_or(NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());

            let mut insert_at = sheet.get_highest_row() + 1;
            if insert_at < start_data_row {
                insert_at = start_data_row;
            }

            let mut found_supplier_block = false;
            for ex in &existing_rows_for_sorting {
                if ex.supplier == target_supplier {
                    found_supplier_block = true;
                    if ex.order_number > target_order {
                        insert_at = ex.row_idx;
                        break;
                    } else if ex.order_number == target_order && ex.date > target_date {
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
                .push((*new_row).clone());
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

            let mut column_styles = Vec::with_capacity(18);
            for col in 1..=18 {
                column_styles.push(sheet.get_style((col, template_row)).clone());
            }

            let (template_height, template_custom_height) =
                match sheet.get_row_dimension(&template_row) {
                    Some(row_dim) => (*row_dim.get_height(), *row_dim.get_custom_height()),
                    None => (0.0, false),
                };

            let template_formula = match sheet.get_cell((13, template_row)) {
                Some(c) => c.get_formula().to_string(),
                None => String::new(),
            };

            for (i, row_data) in batch.iter().enumerate() {
                let r = start_row + i as u32;

                if template_height > 0.0 {
                    let row_dim = sheet.get_row_dimension_mut(&r);
                    row_dim.set_height(template_height);
                    if template_custom_height {
                        row_dim.set_custom_height(true);
                    }
                }

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
                        sheet.set_style((col, r), style.clone());
                    }
                }

                if !template_formula.is_empty() {
                    let new_formula = adjust_formula(&template_formula, formula_source_row, r);
                    sheet.get_cell_mut((13, r)).set_formula(new_formula);
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

    if backup_path.exists() {
        if let Err(e) = fs::remove_file(&backup_path) {
            println!("⚠️ Warning: Konnte temporäres Backup nicht löschen: {}", e);
        }
    }

    let inserted_count = rows_to_insert.len();
    Ok(format!(
        "Finito: {} aggiornati, {} nuovi inseriti.",
        updated_count, inserted_count
    ))
}
