use dotenv::dotenv;
use serde_json::{json, Value};
use std::env;
use tauri::command;

// Der Command muss VOR der run() Funktion stehen und mit #[command] markiert sein
#[command]
async fn ask_mistral(prompt: String) -> Result<Value, String> {
    println!("🦀 Rust hat den Befehl erhalten: {}", prompt); // Log im Terminal
    Ok(serde_json::json!({ "status": "verbunden", "echo": prompt }))
    /*dotenv().ok();

    let api_key =
        env::var("MISTRAL_API_KEY").map_err(|_| "MISTRAL_API_KEY nicht in .env gefunden")?;

    let client = reqwest::Client::new();

    let body = json!({
        "model": "mistral-large-latest",
        "messages": [
            {
                "role": "system",
                "content": "Du bist ein API-Helfer. Antworte ausschließlich mit validem JSON."
            },
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

    let result_obj: Value =
        serde_json::from_str(content_str).map_err(|e| format!("Parsing Fehler: {}", e))?;

    Ok(result_obj)*/
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // WICHTIG: Hier muss ask_mistral registriert sein
        .invoke_handler(tauri::generate_handler![ask_mistral])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
