//! Fixed incoming-translation display protocol, using the existing owned WA view.
use super::platform_bridge::NativePlatform;
use crate::{
    application::ports::BroadcastPlatform,
    domain::{
        account::Account,
        broadcast::GuestBinding,
        error::{AppError, Result},
        translation::{valid_chat_id, IncomingTranslation},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

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
    installed: Mutex<HashMap<String, String>>,
}

impl TranslationGuest {
    pub fn new(platform: Arc<NativePlatform>) -> Self {
        Self {
            platform,
            installed: Mutex::new(HashMap::new()),
        }
    }

    pub fn binding(&self, account: &Account) -> Result<GuestBinding> {
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
        if !installed {
            self.platform
                .install(binding)
                .map_err(|_| AppError::TranslationUnavailable)?;
        }
        let configuration = json!({ "generation": binding.generation,
            "sessionGeneration": session_generation, "settings": account.translation.resolved(),
            "active": active, "autoAfter": auto_after });
        let source = if installed { "" } else { GUEST };
        let script = format!("(() => {{ {source}\n return window.__geekTauriTranslation?.configure({configuration}) === true; }})()");
        if self
            .platform
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
            .platform
            .evaluate(
                binding,
                format!("window.__geekTauriTranslation?.poll({generation}) ?? null"),
            )
            .map_err(|_| AppError::TranslationUnavailable)?;
        let frame: GuestFrame =
            serde_json::from_value(result).map_err(|_| AppError::NetworkResponseInvalid)?;
        let mut ids = HashSet::new();
        if frame.requests.len() > 10
            || frame
                .requests
                .iter()
                .any(|request| !ids.insert(&request.id))
            || frame.chat.as_ref().is_some_and(|chat| {
                !valid_chat_id(&chat.id)
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
        // Reading context does not activate automatic translation or change policy.
        let source = "(() => { const c = window.WPP?.chat?.getActiveChat?.();\n\
            const id = c?.id?._serialized;\n\
            if (!id || c.isNewsletter || c.isBroadcast || c.isParentGroup || c.groupMetadata?.parent) return null;\n\
            return {id, name: String(c.formattedTitle || c.name || c.contact?.pushname || id)\n\
            .replace(/[\\x00-\\x1f\\x7f]/g, '').slice(0, 256)}; })()";
        let value = self
            .platform
            .evaluate(&binding, source.to_owned())
            .map_err(|_| AppError::TranslationUnavailable)?;
        let chat: Option<TranslationChat> =
            serde_json::from_value(value).map_err(|_| AppError::TranslationInvalid)?;
        if chat
            .as_ref()
            .is_some_and(|chat| !valid_chat_id(&chat.id) || chat.name.len() > 1024)
        {
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
        self.platform
            .evaluate(binding, source)
            .map(|value| value == Value::Bool(true))
            .map_err(|_| AppError::TranslationUnavailable)
    }
}
