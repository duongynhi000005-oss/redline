//! Redline's desktop shell: window, menus and the commands the UI calls.

/// Basic facts about the running app, shown in About and used by the UI to
/// pick platform conventions.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub platform: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: redline_core::VERSION,
        platform: std::env::consts::OS,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("error while running Redline");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_version_and_platform() {
        let info = app_info();
        assert_eq!(info.version, redline_core::VERSION);
        assert!(!info.platform.is_empty());
    }
}
