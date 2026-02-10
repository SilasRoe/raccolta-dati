use chrono::NaiveDate;
use regex::Regex;
use serde_json::{json, Value};
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

fn tokenize(s: &str) -> Vec<String> {
    s.split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

fn levenshtein_distance(s1: &str, s2: &str) -> usize {
    let v1: Vec<char> = s1.chars().collect();
    let v2: Vec<char> = s2.chars().collect();
    let len1 = v1.len();
    let len2 = v2.len();

    let mut matrix = vec![vec![0; len2 + 1]; len1 + 1];

    for i in 0..=len1 {
        matrix[i][0] = i;
    }
    for j in 0..=len2 {
        matrix[0][j] = j;
    }

    for i in 0..len1 {
        for j in 0..len2 {
            let cost = if v1[i] == v2[j] { 0 } else { 1 };
            matrix[i + 1][j + 1] = std::cmp::min(
                std::cmp::min(matrix[i][j + 1] + 1, matrix[i + 1][j] + 1),
                matrix[i][j] + cost,
            );
        }
    }

    matrix[len1][len2]
}

pub fn token_similarity(s1: &str, s2: &str) -> f64 {
    let t1 = tokenize(s1);
    let mut t2 = tokenize(s2);

    if t1.is_empty() && t2.is_empty() {
        return 1.0;
    }
    if t1.is_empty() || t2.is_empty() {
        return 0.0;
    }

    let total_words = (t1.len() + t2.len()) as f64;
    let mut matches = 0.0;

    for w1 in &t1 {
        let mut best_score = 0.0;
        let mut best_idx = None;

        for (i, w2) in t2.iter().enumerate() {
            let dist = levenshtein_distance(w1, w2);
            let max_len = w1.chars().count().max(w2.chars().count());
            let score = if max_len == 0 {
                1.0
            } else {
                1.0 - (dist as f64 / max_len as f64)
            };

            if score > best_score {
                best_score = score;
                best_idx = Some(i);
            }
        }

        if best_score > 0.65 {
            matches += best_score;
            if let Some(idx) = best_idx {
                t2.remove(idx);
            }
        }
    }

    (2.0 * matches) / total_words
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
