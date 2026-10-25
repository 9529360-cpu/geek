use crate::{
    application::{
        accounts::Accounts, ports::SystemTranslationCacheClock, send_runner::SendRunner,
        send_translation::SendTranslation, workspace::Workspace,
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
    domain::error::AppError,
    infrastructure::{
        broadcast_preset_repository::EncryptedBroadcastPresetRepository,
        broadcast_repository::EncryptedBroadcastRepository, catalog,
        contact_notes_repository::EncryptedContactNotesRepository, http::HttpTransport, profiles,
        repository::EncryptedRepository, service_api::NativeApi,
        session_repository::EncryptedSessionRepository,
        translation_cache_repository::EncryptedTranslationCacheRepository,
    },
};
use std::sync::{Arc, Mutex};
use tauri::{
    webview::{NewWindowResponse, PermissionResponse, WebviewBuilder},
    window::WindowBuilder,
    LogicalPosition, Manager, WebviewUrl,
};

pub fn run() {
    // The workspace owns one adapter over the per-account encrypted note stores.
    struct ContactNotesRepositoryAdapter {
        root: std::path::PathBuf,
    }

    impl crate::application::ports::ContactNotesStore for ContactNotesRepositoryAdapter {
        fn load(
            &self,
            account_id: &str,
        ) -> crate::domain::error::Result<crate::domain::contact_notes::ContactNotesDocument>
        {
            EncryptedContactNotesRepository::open(&self.root, account_id)?.load()
        }

        fn save(
            &self,
            account_id: &str,
            document: &crate::domain::contact_notes::ContactNotesDocument,
        ) -> crate::domain::error::Result<()> {
            EncryptedContactNotesRepository::open(&self.root, account_id)?.save(document)
        }
    }

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
            commands::broadcast_presets,
            commands::broadcast_save_exclusions,
            commands::broadcast_save_message,
            commands::broadcast_save_audience,
            commands::broadcast_delete_preset,
            commands::broadcast_restore_audience,
            commands::broadcast_export_failures,
            commands::advanced::broadcast_export_contacts,
            commands::advanced::broadcast_history,
            commands::advanced::broadcast_export_history,
            commands::advanced::account_export_backup,
            commands::advanced::account_pick_backup,
            commands::advanced::account_restore_backup,
            commands::broadcast_create,
            commands::broadcast_snapshot,
            commands::broadcast_control,
            commands::session_snapshot,
            commands::session_login,
            commands::session_refresh,
            commands::session_logout,
            commands::contact_notes::contact_notes,
            commands::contact_notes::contact_notes_update,
            commands::translation::translation_context,
            commands::translation::translation_health,
            commands::translation::account_update_translation
        ])
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            let base = app.path().app_local_data_dir()?;
            let root = profiles::prepare_runtime_root(&base)?;
            let repository = EncryptedRepository::open(root.clone())?;
            let accounts = Accounts::open(repository, catalog::load()?)?;
            let shell_profile = root.join("shell");
            std::fs::create_dir_all(&shell_profile)?;
            app.manage(tray::TrayState::new(accounts.settings().close_to_tray));
            let sessions = Arc::new(PlatformSessions::default());
            let host = TauriHost::new(app.handle().clone(), root.clone(), Arc::clone(&sessions));
            let workspace = Arc::new(Mutex::new(Workspace::new(accounts, host)));
            workspace
                .lock()
                .map_err(|_| AppError::StateUnavailable)?
                .set_notes_store(Arc::new(ContactNotesRepositoryAdapter {
                    root: root.clone(),
                }));
            let platform = Arc::new(NativePlatform::new(
                app.handle().clone(),
                Arc::clone(&workspace),
                Arc::clone(&sessions),
            ));
            let broadcast = Arc::new(BroadcastDesktop::new(
                EncryptedBroadcastRepository::open(root.clone())?,
                EncryptedBroadcastPresetRepository::open(root.clone())?,
                Arc::clone(&platform),
                Arc::clone(&sessions),
            )?);
            let api = Arc::new(NativeApi::new(Arc::new(HttpTransport::new()?)));
            let session = Arc::new(NativeSession::open(
                EncryptedSessionRepository::open(root.clone())?,
                Arc::clone(&api),
            )?);
            let translator = Arc::new(NativeTranslation::new_with_cache(
                Arc::clone(&session),
                api,
                Box::new(EncryptedTranslationCacheRepository::new(root)),
                Arc::new(SystemTranslationCacheClock),
            ));
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
