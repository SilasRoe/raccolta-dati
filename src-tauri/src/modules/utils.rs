use chrono::NaiveDate;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::command;

#[command]
pub async fn copy_files(file_paths: Vec<String>, target_dir: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    let target_path = Path::new(&target_dir);
    if !target_path.exists() {
        return Err("La cartella di destinazione non esiste.".to_string());
    }

    for path_str in file_paths {
        let source_path = Path::new(&path_str);
        if let Some(file_name) = source_path.file_name() {
            let dest_path = target_path.join(file_name);
            fs::copy(source_path, dest_path)
                .map_err(|e| format!("Errore durante la copia di {:?}: {}", source_path, e))?;
        }
    }
    Ok(())
}

pub fn close_excel_if_open(path: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let path_str = path.replace("/", "\\").replace("'", "''");

        let script = format!(
            "$target = [System.IO.Path]::GetFullPath('{}'); \
            try {{ \
                $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application'); \
                if ($excel -ne $null) {{ \
                    foreach ($wb in $excel.Workbooks) {{ \
                        if ([System.IO.Path]::GetFullPath($wb.FullName) -eq $target) {{ \
                            $wb.Save(); \
                            $wb.Close(); \
                            break; \
                        }} \
                    }} \
                }} \
            }} catch {{}}",
            path_str
        );

        let _ = std::process::Command::new("powershell")
            .args(&["-NoProfile", "-Command", &script])
            .creation_flags(0x08000000)
            .output();
    }
}

fn tokenize(s: &str) -> HashSet<String> {
    s.split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

pub fn token_similarity(s1: &str, s2: &str) -> f64 {
    let t1 = tokenize(s1);
    let t2 = tokenize(s2);

    if t1.is_empty() || t2.is_empty() {
        return 0.0;
    }

    let intersection_count = t1.intersection(&t2).count();
    let union_count = t1.union(&t2).count();

    if union_count == 0 {
        return 0.0;
    }

    intersection_count as f64 / union_count as f64
}

pub fn parse_date(date_str: &str) -> Option<NaiveDate> {
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%d/%m/%Y") {
        return Some(d);
    }
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%d.%m.%Y") {
        return Some(d);
    }
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return Some(d);
    }

    if let Ok(days) = date_str.parse::<i64>() {
        let base = NaiveDate::from_ymd_opt(1904, 1, 1)?;
        return base.checked_add_signed(chrono::Duration::days(days));
    }
    None
}

pub fn format_to_uppercase(v: &mut Value) {
    match v {
        Value::String(s) => *v = json!(s.to_uppercase()),
        Value::Array(arr) => {
            for item in arr {
                format_to_uppercase(item);
            }
        }
        Value::Object(obj) => {
            for val in obj.values_mut() {
                format_to_uppercase(val);
            }
        }
        _ => {}
    }
}

pub fn adjust_formula(formula: &str, old_row: u32, new_row: u32) -> String {
    let pattern = format!(r"([A-Z]){}\b", old_row);
    let re = Regex::new(&pattern).unwrap();
    re.replace_all(formula, format!("${{1}}{}", new_row))
        .to_string()
}
