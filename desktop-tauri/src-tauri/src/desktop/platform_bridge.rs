//! Fixed semantic calls to one owned WebView. No page is granted native IPC.
use super::{platform_sessions::PlatformSessions, SharedDesktop};
use crate::{
    application::{broadcast::DispatchControl, ports::BroadcastPlatform},
    domain::{
        account::Account,
        broadcast::{BroadcastIssue, DispatchOutcome, DispatchRequest, GuestBinding},
        platform::document_matches,
        translation::supports_outgoing,
    },
};
use serde_json::{json, Value};
use std::{
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, Webview};
use uuid::Uuid;

const WPP: &str = include_str!(concat!(env!("OUT_DIR"), "/wppconnect-wa.js"));
const BRIDGE: &str = include_str!(concat!(env!("OUT_DIR"), "/platform-bridge.js"));
// Preserve the vendor and bundled dependency notices in the distributed binary.
const LICENSES: &str = include_str!(concat!(env!("OUT_DIR"), "/platform-licenses.txt"));
const MAX_REPLY: usize = 4 * 1024 * 1024;
type PlatformResult<T> = std::result::Result<T, BroadcastIssue>;

pub struct NativePlatform {
    app: AppHandle,
    workspace: SharedDesktop,
    sessions: Arc<PlatformSessions>,
    // Serializes only per-document installation, never a send or Workspace.
    installers: Mutex<std::collections::HashMap<String, Arc<Mutex<()>>>>,
}

impl NativePlatform {
    pub fn new(app: AppHandle, workspace: SharedDesktop, sessions: Arc<PlatformSessions>) -> Self {
        Self {
            app,
            workspace,
            sessions,
            installers: Mutex::new(Default::default()),
        }
    }

    pub fn account(&self, id: &str) -> PlatformResult<Account> {
        let snapshot = self
            .workspace
            .lock()
            .map_err(|_| BroadcastIssue::RuntimeFailed)?
            .snapshot();
        snapshot
            .accounts
            .into_iter()
            .find(|a| a.id == id && !a.archived)
            .ok_or(BroadcastIssue::AccountUnavailable)
    }

    pub(super) fn guest(&self, binding: &GuestBinding) -> PlatformResult<Webview> {
        if !supports_outgoing(&binding.platform_id) {
            return Err(BroadcastIssue::CapabilityUnavailable);
        }
        if !self.sessions.valid(binding) {
            return Err(BroadcastIssue::GuestChanged);
        }
        let guest = self
            .app
            .get_webview(&format!("account-{}", binding.account_id))
            .ok_or(BroadcastIssue::AccountUnavailable)?;
        let url = guest
            .url()
            .map_err(|_| BroadcastIssue::AccountUnavailable)?;
        if !document_matches(&binding.platform_id, &url) || !self.sessions.valid(binding) {
            return Err(BroadcastIssue::GuestChanged);
        }
        Ok(guest)
    }

    pub(super) fn evaluate(&self, binding: &GuestBinding, script: String) -> PlatformResult<Value> {
        let guest = self.guest(binding)?;
        let (sender, receiver) = mpsc::sync_channel(1);
        guest
            .eval_with_callback(script, move |value| {
                let _ = sender.try_send(value);
            })
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let value = receiver
            .recv_timeout(Duration::from_secs(4))
            .map_err(|_| BroadcastIssue::TimedOut)?;
        if !self.sessions.valid(binding) {
            return Err(BroadcastIssue::GuestChanged);
        }
        if value.len() > MAX_REPLY {
            return Err(BroadcastIssue::RuntimeFailed);
        }
        serde_json::from_str(&value).map_err(|_| BroadcastIssue::RuntimeFailed)
    }

    pub(super) fn install(&self, binding: &GuestBinding) -> PlatformResult<()> {
        let gate = {
            let mut gates = self
                .installers
                .lock()
                .map_err(|_| BroadcastIssue::RuntimeFailed)?;
            // At most one entry for each of the bounded account IDs.
            gates.entry(binding.account_id.clone()).or_default().clone()
        };
        let _installation = gate.lock().map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let generation = serde_json::to_string(&binding.generation)
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let notices = serde_json::to_string(LICENSES).map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let probe = format!("window.__geekTauriPlatform?.matches({generation}) === true");
        if self.evaluate(binding, probe)? == Value::Bool(true) {
            return Ok(());
        }
        // The marker is set before evaluating the vendor bundle. A failed load
        // requires a fresh document, rather than wrapping WhatsApp twice.
        let vendor = if matches!(binding.platform_id.as_str(), "whatsapp" | "whatsapp-pure") {
            format!(
                "if (!window.__geekWppBundleStarted) {{\n\
                 Object.defineProperty(window, '__geekWppBundleStarted', {{value: true}});\n\
                 void {notices};\n {WPP}\n }}"
            )
        } else {
            String::new()
        };
        let source = format!(
            "(() => {{ if (window !== window.top) return false;\n\
             {vendor}\n {BRIDGE}\n\
             return window.__geekTauriPlatform?.bind({generation}) === true; }})()"
        );
        if self.evaluate(binding, source)? != Value::Bool(true) {
            return Err(BroadcastIssue::CapabilityUnavailable);
        }
        Ok(())
    }

    pub(super) fn call(
        &self,
        binding: &GuestBinding,
        operation: &str,
        payload: Value,
        timeout: Duration,
        control: Option<&DispatchControl>,
    ) -> PlatformResult<Value> {
        let started = Instant::now();
        self.install(binding)?;
        if control.is_some_and(DispatchControl::cancelled) {
            return Err(BroadcastIssue::Cancelled);
        }
        let remaining = timeout
            .checked_sub(started.elapsed())
            .filter(|time| time.as_millis() >= 1)
            .ok_or(BroadcastIssue::TimedOut)?;
        let cleanup_guest = self.guest(binding)?;
        let id = Uuid::new_v4().to_string();
        let request = json!({ "id": id, "generation": binding.generation,
            "platformId": binding.platform_id, "operation": operation, "payload": payload,
            "timeoutMs": remaining.as_millis() });
        let source = format!("window.__geekTauriPlatform?.begin({request}) === true");
        let generation = serde_json::to_string(&binding.generation)
            .map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let id_json = serde_json::to_string(&id).map_err(|_| BroadcastIssue::RuntimeFailed)?;
        let result = (|| {
            // Even a lost begin callback can follow a real side effect. Every
            // path below therefore reaches cleanup on the originally held view.
            if self.evaluate(binding, source)? != Value::Bool(true) {
                return Err(BroadcastIssue::RuntimeFailed);
            }
            loop {
                if control.is_some_and(DispatchControl::cancelled) {
                    return Err(BroadcastIssue::Cancelled);
                }
                if started.elapsed() >= timeout {
                    return Err(BroadcastIssue::TimedOut);
                }
                let value = self.evaluate(
                    binding,
                    format!("window.__geekTauriPlatform?.read({generation}, {id_json}) ?? null"),
                )?;
                // Native monotonic time remains authoritative over a delayed callback.
                if started.elapsed() >= timeout {
                    return Err(BroadcastIssue::TimedOut);
                }
                if value.is_null() {
                    return Err(BroadcastIssue::TimedOut);
                }
                if value.get("pending") == Some(&Value::Bool(false)) {
                    if let Some(code) = value.get("error") {
                        return Err(serde_json::from_value(code.clone())
                            .unwrap_or(BroadcastIssue::RuntimeFailed));
                    }
                    return value
                        .get("value")
                        .cloned()
                        .ok_or(BroadcastIssue::RuntimeFailed);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })();
        // Fire-and-forget invalidation is safe: it only prevents further effects.
        // An already invoked platform operation remains uncertain on timeout.
        let method = if result.is_ok() { "forget" } else { "cancel" };
        let _ = cleanup_guest.eval(format!(
            "window.__geekTauriPlatform?.{method}({generation}, {id_json})"
        ));
        result
    }

    pub fn catalog(&self, binding: &GuestBinding) -> PlatformResult<Value> {
        self.call(
            binding,
            "catalog",
            Value::Null,
            Duration::from_secs(18),
            None,
        )
    }
}

impl BroadcastPlatform for NativePlatform {
    fn acquire_binding(&self, account_id: &str, platform_id: &str) -> PlatformResult<GuestBinding> {
        let account = self.account(account_id)?;
        if account.platform_id != platform_id {
            return Err(BroadcastIssue::GuestChanged);
        }
        if !supports_outgoing(platform_id) {
            return Err(BroadcastIssue::CapabilityUnavailable);
        }
        let binding = self.sessions.binding(account_id, platform_id)?;
        self.guest(&binding)?;
        // Scheduled readiness retries happen before a target checkpoint exists.
        // Page Finished alone is not proof that the owned platform session is ready.
        self.call(
            &binding,
            "ready",
            Value::Null,
            Duration::from_secs(18),
            None,
        )?;
        Ok(binding)
    }

    fn local_hour(&self, binding: &GuestBinding) -> PlatformResult<u8> {
        let hour = self
            .evaluate(binding, "new Date().getHours()".to_owned())?
            .as_u64()
            .filter(|hour| *hour < 24)
            .ok_or(BroadcastIssue::RuntimeFailed)?;
        Ok(hour as u8)
    }

    fn dispatch(
        &self,
        binding: &GuestBinding,
        request: &DispatchRequest,
        control: &DispatchControl,
    ) -> DispatchOutcome {
        if !request.attachments.is_empty() {
            return self.dispatch_attachments(binding, request, control);
        }
        let failure = |code| DispatchOutcome::NotSubmitted { code };
        if control.cancelled() {
            return failure(BroadcastIssue::Cancelled);
        }
        if self.account(&binding.account_id).is_err() {
            return failure(BroadcastIssue::AccountUnavailable);
        }
        let payload = json!({ "attemptId": request.attempt_id, "jobId": request.job_id,
            "targetId": request.target_id, "message": request.rendered_text,
            "tagAll": request.tag_all, "vcards": request.vcards });
        if let Err(code) = self.call(
            binding,
            "prepare",
            payload,
            Duration::from_secs(18),
            Some(control),
        ) {
            return failure(code);
        }
        if self.guest(binding).is_err() {
            return failure(BroadcastIssue::GuestChanged);
        }
        if !control.try_begin_commit() {
            return failure(BroadcastIssue::Cancelled);
        }
        // Once this gate opens, all transport failures are potentially submitted.
        // Polling one mailbox never invokes the sending operation again.
        match self.call(
            binding,
            "dispatch",
            json!({ "attemptId": request.attempt_id }),
            Duration::from_secs(35),
            Some(control),
        ) {
            Ok(value) => serde_json::from_value(value).unwrap_or(DispatchOutcome::Uncertain {
                code: BroadcastIssue::RuntimeFailed,
            }),
            Err(code) => DispatchOutcome::Uncertain { code },
        }
    }
}
