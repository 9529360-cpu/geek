//! Fixed incoming display protocol for an owned WA or Telegram document.
use super::{platform_bridge::NativePlatform, platform_sessions::PlatformSessions};
use crate::{
    application::ports::BroadcastPlatform,
    domain::{
        account::Account,
        broadcast::GuestBinding,
        error::{AppError, Result},
        translation::{is_telegram, valid_receive_chat_id, IncomingTranslation},
        url_policy::safe_https,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};

use tauri::{AppHandle, Manager, Webview};
use url::Url;

#[cfg(test)]
mod tests;

const GUEST: &str = include_str!(concat!(env!("OUT_DIR"), "/translation-guest.js"));

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationChat {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationContext {
    pub account_id: String,
    pub generation: String,
    pub chat: Option<TranslationChat>,
    pub available: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestFrame {
    pub chat: Option<TranslationChat>,
    pub requests: Vec<IncomingTranslation>,
}

pub struct TranslationGuest {
    platform: Arc<NativePlatform>,
    app: AppHandle,
    sessions: Arc<PlatformSessions>,
    installed: Mutex<HashMap<String, String>>,
}

impl TranslationGuest {
    pub fn new(
        platform: Arc<NativePlatform>,
        app: AppHandle,
        sessions: Arc<PlatformSessions>,
    ) -> Self {
        Self {
            platform,
            app,
            sessions,
            installed: Mutex::new(HashMap::new()),
        }
    }

    pub fn binding(&self, account: &Account) -> Result<GuestBinding> {
        if is_telegram(&account.platform_id) {
            let binding = self
                .sessions
                .binding(&account.id, &account.platform_id)
                .map_err(|_| AppError::TranslationUnavailable)?;
            self.telegram_guest(&binding)?;
            return Ok(binding);
        }
        self.platform
            .acquire_binding(&account.id, &account.platform_id)
            .map_err(|_| AppError::TranslationUnavailable)
    }

    pub fn configure(
        &self,
        binding: &GuestBinding,
        account: &Account,
        session_generation: Option<&str>,
        active: bool,
        auto_after: u64,
    ) -> Result<()> {
        let installed = self
            .installed
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .get(&binding.account_id)
            .is_some_and(|generation| generation == &binding.generation);
        if !installed && !is_telegram(&binding.platform_id) {
            self.platform
                .install(binding)
                .map_err(|_| AppError::TranslationUnavailable)?;
        }
        let configuration = json!({ "generation": binding.generation, "platformId": binding.platform_id,
            "sessionGeneration": session_generation, "settings": account.translation.resolved(),
            "active": active, "autoAfter": auto_after });
        let source = if installed { "" } else { GUEST };
        let script = format!("(() => {{ {source}\n return window.__geekTauriTranslation?.configure({configuration}) === true; }})()");
        if self
            .evaluate(binding, script)
            .map_err(|_| AppError::TranslationUnavailable)?
            != Value::Bool(true)
        {
            return Err(AppError::TranslationUnavailable);
        }
        self.installed
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .insert(binding.account_id.clone(), binding.generation.clone());
        Ok(())
    }

    pub fn poll(&self, binding: &GuestBinding) -> Result<GuestFrame> {
        let generation = json!(binding.generation);
        let result = self
            .evaluate(
                binding,
                format!("window.__geekTauriTranslation?.poll({generation}) ?? null"),
            )
            .map_err(|_| AppError::TranslationUnavailable)?;
        let frame: GuestFrame =
            serde_json::from_value(result).map_err(|_| AppError::NetworkResponseInvalid)?;
        let mut ids = HashSet::new();
        if frame.requests.len() > 10
            || frame.requests.iter().any(|request| {
                !ids.insert(&request.id)
                    || request.validate_for_platform(&binding.platform_id).is_err()
            })
            || frame.chat.as_ref().is_some_and(|chat| {
                !valid_receive_chat_id(&binding.platform_id, &chat.id)
                    || chat.name.len() > 1024
                    || chat.name.chars().any(char::is_control)
            })
        {
            return Err(AppError::TranslationInvalid);
        }
        Ok(frame)
    }

    pub fn context(&self, account: &Account) -> Result<TranslationContext> {
        let mut context = TranslationContext {
            account_id: account.id.clone(),
            generation: String::new(),
            chat: None,
            available: false,
        };
        let Ok(binding) = self.binding(account) else {
            return Ok(context);
        };
        // Pure context inspection binds the document without activating requests or policy.
        let script = format!("(() => {{ {GUEST}\n return window.__geekTauriTranslation?.context({}, {}) ?? null; }})()",
            json!(binding.generation), json!(binding.platform_id));
        let value = self.evaluate(&binding, script)?;
        let chat: Option<TranslationChat> =
            serde_json::from_value(value).map_err(|_| AppError::TranslationInvalid)?;
        if chat.as_ref().is_some_and(|chat| {
            !valid_receive_chat_id(&binding.platform_id, &chat.id) || chat.name.len() > 1024
        }) {
            return Err(AppError::TranslationInvalid);
        }
        context.generation = binding.generation;
        context.chat = chat;
        context.available = true;
        Ok(context)
    }

    pub fn deliver(
        &self,
        binding: &GuestBinding,
        session: &str,
        revision: u64,
        incoming: &IncomingTranslation,
        result: &Result<String>,
    ) -> Result<bool> {
        let result = match result {
            Ok(text) => json!({ "text": text }),
            Err(error) => json!({ "error": error.code() }),
        };
        let arguments = [
            json!(binding.generation),
            json!(session),
            json!(revision),
            json!(incoming.id),
            json!(incoming.attempt),
            result,
        ];
        let source = format!(
            "window.__geekTauriTranslation?.deliver(...{}) === true",
            json!(arguments)
        );
        self.evaluate(binding, source)
            .map(|value| value == Value::Bool(true))
            .map_err(|_| AppError::TranslationUnavailable)
    }

    fn telegram_guest(&self, binding: &GuestBinding) -> Result<Webview> {
        if !is_telegram(&binding.platform_id) || !self.sessions.valid(binding) {
            return Err(AppError::TranslationUnavailable);
        }
        let guest = self
            .app
            .get_webview(&format!("account-{}", binding.account_id))
            .ok_or(AppError::TranslationUnavailable)?;
        let url = guest.url().map_err(|_| AppError::TranslationUnavailable)?;
        if !telegram_url_matches(&binding.platform_id, &url) || !self.sessions.valid(binding) {
            return Err(AppError::TranslationUnavailable);
        }
        Ok(guest)
    }

    // Only fixed callers above supply scripts. Neither renderer nor remote page receives an eval IPC.
    fn evaluate(&self, binding: &GuestBinding, script: String) -> Result<Value> {
        if !is_telegram(&binding.platform_id) {
            return self
                .platform
                .evaluate(binding, script)
                .map_err(|_| AppError::TranslationUnavailable);
        }
        let guest = self.telegram_guest(binding)?;
        let (sender, receiver) = mpsc::sync_channel(1);
        guest
            .eval_with_callback(script, move |value| {
                let _ = sender.try_send(value);
            })
            .map_err(|_| AppError::TranslationUnavailable)?;
        let value = receiver
            .recv_timeout(Duration::from_secs(4))
            .map_err(|_| AppError::TranslationTimeout)?;
        self.telegram_guest(binding)?;
        if value.len() > 4 * 1024 * 1024 {
            return Err(AppError::TranslationInvalid);
        }
        serde_json::from_str(&value).map_err(|_| AppError::TranslationInvalid)
    }
}

fn telegram_url_matches(platform: &str, url: &Url) -> bool {
    safe_https(url)
        && url.host_str() == Some("web.telegram.org")
        && url.query().is_none()
        && match platform {
            "telegram-z" => matches!(url.path(), "/a" | "/a/"),
            "telegram-k" => matches!(url.path(), "/k" | "/k/"),
            _ => false,
        }
}
