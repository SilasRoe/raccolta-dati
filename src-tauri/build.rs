use std::fs;
use std::path::Path;

fn main() {
    let env_path = Path::new("../.env");

    println!("cargo:rerun-if-changed={}", env_path.display());

    if let Ok(contents) = fs::read_to_string(env_path) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if let Some((key, value)) = line.split_once('=') {
                let clean_value = value.trim().trim_matches('"').trim_matches('\'');

                println!("cargo:rustc-env={}={}", key.trim(), clean_value);
            }
        }
    } else {
        println!(
            "cargo:warning=Keine .env Datei gefunden unter: {}",
            env_path.display()
        );
    }
    tauri_build::build();
}
