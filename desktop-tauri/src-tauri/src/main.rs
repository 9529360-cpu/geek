#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(not(target_os = "windows"))]
compile_error!("The Geek Tauri prototype currently targets Windows only.");

mod dpapi;
mod policy;
mod runtime;
mod store;
mod tray;

use std::sync::Mutex;
use tauri::{LogicalPosition, Manager, WebviewUrl,
    webview::{NewWindowResponse, PermissionResponse, WebviewBuilder}, window::WindowBuilder};

fn main() {
    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime::desktop_snapshot, runtime::account_create,
            runtime::account_activate, runtime::account_close, runtime::account_reload,
            runtime::desktop_layout, runtime::account_rename, runtime::account_set_archived,
            runtime::desktop_settings])
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            let base = app.path().app_local_data_dir()?;
            let root = store::runtime_root(&base);
            let store = store::Store::open(root.clone()).map_err(std::io::Error::other)?;
            let shell_profile = root.join("shell");
            std::fs::create_dir_all(&shell_profile)?;
            app.manage(tray::TrayState::new(store.settings.close_to_tray));
            app.manage(Mutex::new(runtime::Desktop { store, active_id: None }));
            let window = WindowBuilder::new(app, "main")
                .title("极客 · Tauri Windows 开发版")
                .inner_size(1280.0, 820.0).min_inner_size(960.0, 640.0).build()?;
            let shell = WebviewBuilder::new("shell", WebviewUrl::App("index.html".into()))
                .auto_resize().data_directory(shell_profile).use_https_scheme(true)
                // CSS chrome and native child bounds use the same logical pixels.
                .zoom_hotkeys_enabled(false)
                .devtools(cfg!(debug_assertions))
                .on_navigation(policy::shell_url)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .on_download(|_, _| false);
            let available = tray::install(app).unwrap_or(false);
            app.state::<tray::TrayState>().set_available(available);
            window.add_child(shell, LogicalPosition::new(0.0, 0.0), window.inner_size()?)?;
            Ok(())
        })
        .run(tauri::generate_context!());
    if result.is_err() {
        eprintln!("GEEK_STARTUP_FAILED: check WebView2, profile lock and encrypted state; no data was reset.");
        std::process::exit(1);
    }
}
