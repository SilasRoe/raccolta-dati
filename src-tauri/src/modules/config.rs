use keyring::Entry;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use tauri::command;
use tauri_plugin_store::StoreExt;

const KEYRING_SERVICE: &str = "com.silas.raccolta-dati";
const KEYRING_USER: &str = "mistral_api_key";

#[command]
pub async fn get_corrections(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let store = app
        .store("corrections.json")
        .map_err(|e| format!("Store errore: {}", e))?;

    match store.get("product_corrections") {
        Some(val) => serde_json::from_value(val).map_err(|e| format!("Parse errore: {}", e)),
        None => Ok(HashMap::new()),
    }
}

#[command]
pub async fn remove_correction(app: tauri::AppHandle, wrong: String) -> Result<(), String> {
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

#[command]
pub async fn save_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
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

#[command]
pub async fn get_api_key() -> Result<String, String> {
    let entry = match Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(e) => e,
        Err(_) => return Ok("".to_string()),
    };

    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(_) => Ok("".to_string()),
    }
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
pub async fn learn_correction(
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

#[command]
pub async fn move_files(paths: Vec<String>, target_dir: String) -> Result<(), String> {
    if target_dir.trim().is_empty() {
        return Ok(());
    }

    let dest_path = std::path::Path::new(&target_dir);
    if !dest_path.exists() {
        fs::create_dir_all(dest_path)
            .map_err(|e| format!("Impossibile creare la cartella: {}", e))?;
    }

    for path_str in paths {
        let source_path = std::path::Path::new(&path_str);
        if source_path.exists() {
            let file_name = source_path.file_name().ok_or("Nome file non valido")?;
            let mut target_path = dest_path.join(file_name);

            if target_path.exists() {
                let stem = source_path.file_stem().unwrap().to_string_lossy();
                let ext = source_path.extension().unwrap().to_string_lossy();
                let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
                target_path = dest_path.join(format!("{}_{}.{}", stem, timestamp, ext));
            }

            fs::rename(source_path, target_path)
                .map_err(|e| format!("Errore durante lo spostamento di {}: {}", path_str, e))?;
        }
    }
    Ok(())
}
