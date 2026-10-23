use crate::{
    application::{
        accounts::Accounts, send_runner::SendRunner, send_translation::SendTranslation,
        workspace::Workspace,
    },
    desktop::{
        broadcast::BroadcastDesktop,
        commands,
        host::TauriHost,
        platform_bridge::NativePlatform,
        platform_sessions::PlatformSessions,
        security,
        send_guest::SendGuest,
        session::{NativeSession, NativeTranslation},
        translation::TranslationDesktop,
        translation_guest::TranslationGuest,
        tray,
    },
    infrastructure::{
        broadcast_repository::EncryptedBroadcastRepository, catalog, http::HttpTransport, profiles,
        repository::EncryptedRepository, service_api::NativeApi,
        session_repository::EncryptedSessionRepository,
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
            commands::broadcast_pick_attachments,
            commands::broadcast_release_attachments,
            commands::broadcast_import_contacts,
            commands::broadcast_resolve_recipients,
            commands::broadcast_resolve_audience,
            commands::broadcast_export_failures,
            commands::broadcast_create,
            commands::broadcast_snapshot,
            commands::broadcast_control,
            commands::session_snapshot,
            commands::session_login,
            commands::session_refresh,
            commands::session_logout,
            commands::translation_context,
            commands::account_update_translation
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
                EncryptedBroadcastRepository::open(root.clone())?,
                Arc::clone(&platform),
                Arc::clone(&sessions),
            )?);
            let api = Arc::new(NativeApi::new(Arc::new(HttpTransport::new()?)));
            let session = Arc::new(NativeSession::open(
                EncryptedSessionRepository::open(root)?,
                Arc::clone(&api),
            )?);
            let translator = Arc::new(NativeTranslation::new(Arc::clone(&session), api));
            let sending = Arc::new(SendRunner::new(
                Arc::new(SendGuest::new(
                    Arc::clone(&platform),
                    Arc::clone(&workspace),
                    Arc::clone(&sessions),
                )),
                Arc::new(SendTranslation::new(
                    Arc::clone(&session),
                    Arc::clone(&translator),
                )),
            ));
            let translation = Arc::new(TranslationDesktop::new(
                Arc::clone(&workspace),
                Arc::clone(&sessions),
                Arc::clone(&session),
                translator,
                TranslationGuest::new(platform, app.handle().clone(), sessions),
            ));
            app.manage(workspace);
            app.manage(Arc::clone(&broadcast));
            app.manage(session);
            app.manage(Arc::clone(&translation));
            app.manage(Arc::clone(&sending));
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
            translation.start()?;
            sending.start()?;
            Ok(())
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(owner) = handle.try_state::<Arc<BroadcastDesktop>>() {
                    owner.shutdown();
                }
                if let Some(owner) = handle.try_state::<Arc<TranslationDesktop>>() {
                    owner.shutdown();
                }
                if let Some(owner) = handle.try_state::<Arc<SendRunner>>() {
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
