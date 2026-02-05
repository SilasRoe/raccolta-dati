use chrono::NaiveDate;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;

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
