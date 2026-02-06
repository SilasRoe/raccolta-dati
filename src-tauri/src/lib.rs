mod modules;
use modules::{ai, config, excel, ui, utils};

use std::env;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ai::analyze_document,
            excel::export_to_excel,
            config::save_api_key,
            config::get_api_key,
            config::learn_correction,
            config::get_corrections,
            config::remove_correction,
            config::move_files,
            excel::check_excel_access,
            ui::set_taskbar_progress,
            utils::copy_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
