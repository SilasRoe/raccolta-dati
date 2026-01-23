use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{command, Manager};

#[command]
pub async fn set_taskbar_progress(
    app: tauri::AppHandle,
    progress: u64,
    total: u64,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    if total > 0 {
        let percentage = ((progress as f64 / total as f64) * 100.0) as u64;
        let percentage = percentage.min(100);

        window
            .set_progress_bar(ProgressBarState {
                progress: Some(percentage),
                status: Some(ProgressBarStatus::Normal),
            })
            .map_err(|e| e.to_string())?;
    } else {
        window
            .set_progress_bar(ProgressBarState {
                progress: Some(0),
                status: None,
            })
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
