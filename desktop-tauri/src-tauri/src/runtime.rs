use crate::{policy::{self, NavigationPolicy, PlatformInfo, Result}, store::{Account, Settings, Store}, tray::TrayState};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Webview, WebviewUrl, Window,
    webview::{NewWindowResponse, PermissionResponse, WebviewBuilder}};

pub const SIDEBAR: f64 = 280.0;
pub const HEADER: f64 = 88.0;
pub const FOOTER: f64 = 28.0;

pub struct Desktop { pub store: Store, pub active_id: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    accounts: Vec<Account>,
    platforms: Vec<PlatformInfo>,
    active_id: Option<String>,
    opened_ids: Vec<String>,
    settings: Settings,
    tray_available: bool,
}

fn label(id: &str) -> String { format!("account-{id}") }

fn authorize(webview: &Webview) -> Result<()> {
    if webview.label() != "shell" || webview.window().label() != "main"
        || !policy::shell_url(&webview.url().map_err(|_| "FORBIDDEN")?) {
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
        settings: d.store.settings.clone(),
        tray_available: app.state::<TrayState>().available(),
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
pub async fn desktop_snapshot(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>) -> Result<Snapshot> {
    authorize(&webview)?;
    let d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    Ok(snapshot(&d, &app))
}

#[tauri::command]
pub async fn account_create(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    name: String, platform_id: String, website_url: Option<String>) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.create(&name, &platform_id, website_url.as_deref())?;
    Ok(snapshot(&d, &app))
}

#[tauri::command]
pub async fn account_rename(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String, name: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.rename(&id, &name)?;
    Ok(snapshot(&d, &app))
}

#[tauri::command]
pub async fn account_set_archived(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String, archived: bool) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.account(&id)?;
    // Require a successful close before committing an archive. This is enforced
    // in Rust even if a local caller bypasses the frontend sequence.
    if archived && app.get_webview(&label(&id)).is_some() { return Err("ACCOUNT_STILL_OPEN"); }
    d.store.set_archived(&id, archived)?;
    if archived && d.active_id.as_deref() == Some(id.as_str()) { d.active_id = None; }
    Ok(snapshot(&d, &app))
}

#[tauri::command]
pub async fn desktop_settings(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    settings: Settings) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    let tray = app.state::<TrayState>();
    if settings.close_to_tray && !tray.available() { return Err("TRAY_UNAVAILABLE"); }
    d.store.set_settings(settings)?;
    // The UI-thread close callback never locks Desktop: a command may be waiting
    // on that thread to create a WebView. Publish only after durable commit.
    tray.set_close_to_tray(d.store.settings.close_to_tray);
    Ok(snapshot(&d, &app))
}

// WebView2 creation MUST remain async; synchronous commands can deadlock.
#[tauri::command]
pub async fn account_activate(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    let account = d.store.openable_account(&id)?;
    let window = app.get_window("main").ok_or("WEBVIEW_FAILED")?;
    let guest = match app.get_webview(&label(&id)) {
        Some(existing) => existing,
        None => {
            let platform = policy::platform(&d.store.platforms, &account.platform_id)?;
            let navigation = NavigationPolicy::new(platform, account.website_url.as_deref())?;
            let profile = d.store.profile(&id)?;
            std::fs::create_dir_all(&profile).map_err(|_| "STORE_IO")?;
            let builder = WebviewBuilder::new(label(&id), WebviewUrl::External(navigation.start().clone()))
                .data_directory(profile)
                .browser_extensions_enabled(false)
                .devtools(false)
                .focused(false)
                .on_navigation(move |url| navigation.allows(url))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_permission_request(|_, _| PermissionResponse::Deny)
                .on_download(|_, _| false);
            let (_, size) = bounds(&window)?;
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
pub async fn account_close(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let mut d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.account(&id)?;
    if let Some(guest) = app.get_webview(&label(&id)) {
        guest.close().map_err(|_| "WEBVIEW_FAILED")?;
    }
    if d.active_id.as_deref() == Some(id.as_str()) { d.active_id = None; }
    Ok(snapshot(&d, &app))
}

#[tauri::command]
pub async fn account_reload(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>,
    id: String) -> Result<Snapshot> {
    authorize(&webview)?;
    let d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    d.store.openable_account(&id)?;
    app.get_webview(&label(&id)).ok_or("ACCOUNT_NOT_OPEN")?.reload().map_err(|_| "WEBVIEW_FAILED")?;
    Ok(snapshot(&d, &app))
}

#[tauri::command]
pub async fn desktop_layout(webview: Webview, app: AppHandle, state: State<'_, Mutex<Desktop>>) -> Result<()> {
    authorize(&webview)?;
    let d = state.lock().map_err(|_| "STATE_UNAVAILABLE")?;
    let window = app.get_window("main").ok_or("WEBVIEW_FAILED")?;
    for a in &d.store.accounts {
        if let Some(guest) = app.get_webview(&label(&a.id)) { fit(&guest, &window)?; }
    }
    Ok(())
}
