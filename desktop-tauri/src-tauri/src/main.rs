#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(not(target_os = "windows"))]
compile_error!("The Geek Tauri prototype currently targets Windows only.");

mod dpapi;
mod policy;
mod store;

use policy::{PlatformInfo, Result};
use serde::Serialize;
use std::sync::Mutex;
use store::{Account, Store};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Webview, WebviewUrl, Window,
    webview::{NewWindowResponse, PermissionResponse, WebviewBuilder}, window::WindowBuilder};

const SIDEBAR: f64 = 280.0;
const HEADER: f64 = 88.0;
const FOOTER: f64 = 28.0;

struct Desktop { store: Store, active_id: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    accounts: Vec<Account>,
    platforms: Vec<PlatformInfo>,
    active_id: Option<String>,
    opened_ids: Vec<String>,
}

fn label(id: &str) -> String { format!("account-{id}") }

fn authorize(webview: &Webview) -> Result<()> {
    if webview.label() != "shell" || webview.window().label() != "main" ||
        !policy::shell_url(&webview.url().map_err(|_| "FORBIDDEN")?) {
        return Err("FORBIDDEN");
    }
    Ok(())
}

fn snapshot(d: &Desktop, app: &AppHandle) -> Snapshot {
    Snapshot {
        accounts: d.store.accounts.clone(),
        platforms: d.store.platforms.iter().map(|p| p.info()).collect(),
        active_id: d.active_id.clone(),
        opened_ids: d.store.accounts.iter().filter(|a| app.get_webview(&label(&a.id)).is_some())
            .map(|a| a.id.clone()).collect(),
    }
}

fn bounds(window: &Window) -> Result<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let scale = window.scale_factor().map_err(|_| "WEBVIEW_FAILED")?;
    let size = window.inner_size().map_err(|_| "WEBVIEW_FAILED")?.to_logical::<f64>(scale);
    Ok((LogicalPosition::new(SIDEBAR, HEADER),
        LogicalSize::new((size.width - SIDEBAR).max(1.0), (size.height - HEADER - FOOTER).max(1.0))))
}

fn fit(webview: &Webview, window: &Window) -> Result<()> {
    let (position, size) = bounds(window)?;
    webview.set_bounds(tauri::Rect { position: position.into(), size: size.into() })
        .map_err(|_| "WEBVIEW_FAILED")
}

#[tauri::command]
async fn desktop_snapshot(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>) -> Result<Snapshot> {
    authorize(&webview)?;
    let d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    Ok(snapshot(&d, &app))
}

#[tauri::command]
async fn account_create(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    name: String, platform_id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.create(&name, &platform_id)?;
    Ok(snapshot(&d, &app))
}

// WebView2 creation MUST remain an async command; synchronous commands can deadlock.
#[tauri::command]
async fn account_activate(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    let account = d.store.account(&id)?;
    let window = app.get_window("main").ok_or("WEBVIEW_FAILED")?;
    let guest = match app.get_webview(&label(&id)) {
        Some(existing) => existing,
        None => {
            let platform = policy::platform(&d.store.platforms, &account.platform_id)?.clone();
            let url = platform.url.as_ref().ok_or("PLATFORM_UNAVAILABLE")?
                .parse::<tauri::Url>().map_err(|_| "CATALOG_INVALID")?;
            if !platform.allows(&url) { return Err("CATALOG_INVALID"); }
            let profile = d.store.profile(&id)?;
            std::fs::create_dir_all(&profile).map_err(|_| "STORE_IO")?;
            let builder = WebviewBuilder::new(label(&id), WebviewUrl::External(url))
                .data_directory(profile)
                .browser_extensions_enabled(false)
                .devtools(false)
                .focused(false)
                .on_navigation(move |url| platform.allows(url))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .on_download(|_, _| false);
            let (_, size) = bounds(&window)?;
            // Create off-screen so no account is shown under another account's heading.
            let guest = window.add_child(builder, LogicalPosition::new(100_000.0, 0.0), size)
                .map_err(|_| "WEBVIEW_FAILED")?;
            if guest.hide().is_err() {
                let _ = guest.close();
                return Err("WEBVIEW_FAILED");
            }
            guest
        }
    };
    let previous = d.active_id.clone();
    let transition = (|| -> Result<()> {
        fit(&guest, &window)?;
        for other in &d.store.accounts {
            if other.id != id {
                if let Some(view) = app.get_webview(&label(&other.id)) {
                    view.hide().map_err(|_| "WEBVIEW_FAILED")?;
                }
            }
        }
        guest.show().map_err(|_| "WEBVIEW_FAILED")?;
        guest.set_focus().map_err(|_| "WEBVIEW_FAILED")?;
        Ok(())
    })();
    if transition.is_err() {
        let _ = guest.hide();
        let restored = previous.as_ref().and_then(|id| app.get_webview(&label(id)))
            .is_some_and(|view| view.show().is_ok());
        d.active_id = if restored { previous } else { None };
        return Err("WEBVIEW_FAILED");
    }
    d.active_id = Some(id);
    Ok(snapshot(&d, &app))
}

#[tauri::command]
async fn account_close(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.account(&id)?;
    if let Some(guest) = app.get_webview(&label(&id)) {
        guest.close().map_err(|_| "WEBVIEW_FAILED")?;
    }
    if d.active_id.as_deref() == Some(id.as_str()) { d.active_id = None; }
    // Closing a view never deletes account metadata, cookies or storage.
    Ok(snapshot(&d, &app))
}

#[tauri::command]
async fn account_reload(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.account(&id)?;
    app.get_webview(&label(&id)).ok_or("ACCOUNT_NOT_OPEN")?.reload().map_err(|_| "WEBVIEW_FAILED")?;
    Ok(snapshot(&d, &app))
}

#[tauri::command]
async fn desktop_layout(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>) -> Result<()> {
    authorize(&webview)?;
    let d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    let window = app.get_window("main").ok_or("WEBVIEW_FAILED")?;
    for a in &d.store.accounts {
        if let Some(guest) = app.get_webview(&label(&a.id)) { fit(&guest, &window)?; }
    }
    Ok(())
}

fn main() {
    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_snapshot, account_create,
            account_activate, account_close, account_reload, desktop_layout])
        .setup(|app| {
            let base = app.path().app_local_data_dir()?;
            let root = store::runtime_root(&base);
            let store = Store::open(root.clone()).map_err(std::io::Error::other)?;
            let shell_profile = root.join("shell");
            std::fs::create_dir_all(&shell_profile)?;
            app.manage(Mutex::new(Desktop { store, active_id: None }));
            let window = WindowBuilder::new(app, "main")
                .title("极客 · Tauri Windows 开发版")
                .inner_size(1280.0, 820.0).min_inner_size(960.0, 640.0).build()?;
            let shell = WebviewBuilder::new("shell", WebviewUrl::App("index.html".into()))
                .auto_resize().data_directory(shell_profile).use_https_scheme(true)
                .devtools(cfg!(debug_assertions))
                .on_navigation(policy::shell_url)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .on_download(|_, _| false);
            window.add_child(shell, LogicalPosition::new(0.0, 0.0), window.inner_size()?)?;
            Ok(())
        })
        .run(tauri::generate_context!());
    if result.is_err() {
        // Do not print platform errors containing private paths, URLs or profile contents.
        eprintln!("GEEK_STARTUP_FAILED: check WebView2, profile lock and encrypted state; no data was reset.");
        std::process::exit(1);
    }
}
