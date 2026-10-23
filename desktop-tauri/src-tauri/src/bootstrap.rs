use crate::{
    application::{accounts::Accounts, workspace::Workspace},
    desktop::{
        broadcast::BroadcastDesktop, commands, host::TauriHost, platform_bridge::NativePlatform,
        platform_sessions::PlatformSessions, security, tray,
    },
    infrastructure::{
        broadcast_repository::EncryptedBroadcastRepository, catalog, profiles,
        repository::EncryptedRepository,
    },
};
use std::sync::{Arc, Mutex};
use tauri::{
    webview::{NewWindowResponse, PermissionResponse, WebviewBuilder},
    window::WindowBuilder,
    LogicalPosition, Manager, WebviewUrl,
};

pub fn run() {
    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::desktop_snapshot,
            commands::account_create,
            commands::account_create_batch,
            commands::account_set_proxy,
            commands::account_activate,
            commands::account_close,
            commands::account_reload,
            commands::desktop_layout,
            commands::account_rename,
            commands::account_update_display,
            commands::account_move,
            commands::account_set_archived,
            commands::desktop_settings,
            commands::desktop_window,
            commands::broadcast_catalog,
            commands::broadcast_create,
            commands::broadcast_snapshot,
            commands::broadcast_control
        ])
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            let base = app.path().app_local_data_dir()?;
            let root = profiles::runtime_root(&base);
            let repository = EncryptedRepository::open(root.clone())?;
            let accounts = Accounts::open(repository, catalog::load()?)?;
            let shell_profile = root.join("shell");
            std::fs::create_dir_all(&shell_profile)?;
            app.manage(tray::TrayState::new(accounts.settings().close_to_tray));
            let sessions = Arc::new(PlatformSessions::default());
            let host = TauriHost::new(app.handle().clone(), root.clone(), Arc::clone(&sessions));
            let workspace = Arc::new(Mutex::new(Workspace::new(accounts, host)));
            let platform = Arc::new(NativePlatform::new(
                app.handle().clone(),
                Arc::clone(&workspace),
                Arc::clone(&sessions),
            ));
            let broadcast = Arc::new(BroadcastDesktop::new(
                EncryptedBroadcastRepository::open(root)?,
                platform,
                sessions,
            )?);
            app.manage(workspace);
            app.manage(Arc::clone(&broadcast));
            let window = WindowBuilder::new(app, "main")
                .title("极客 · Tauri Windows 开发版")
                .decorations(false)
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 640.0)
                .build()?;
            let shell = WebviewBuilder::new("shell", WebviewUrl::App("index.html".into()))
                .auto_resize()
                .data_directory(shell_profile)
                .use_https_scheme(true)
                // CSS chrome and native child bounds use the same logical pixels.
                .zoom_hotkeys_enabled(false)
                .devtools(cfg!(debug_assertions))
                .on_navigation(security::shell_url)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .on_download(|_, _| false);
            let available = tray::install(app).unwrap_or(false);
            app.state::<tray::TrayState>().set_available(available);
            window.add_child(shell, LogicalPosition::new(0.0, 0.0), window.inner_size()?)?;
            broadcast.start()?;
            Ok(())
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(owner) = handle.try_state::<Arc<BroadcastDesktop>>() {
                    owner.shutdown();
                }
            }
        }),
        Err(_) => {
            eprintln!("GEEK_STARTUP_FAILED: check WebView2, profile lock and encrypted state; no data was reset.");
            std::process::exit(1);
        }
    }
}
