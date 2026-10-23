//! Fixed interactive-send bridge. The remote document never receives native IPC.
use super::{platform_bridge::NativePlatform, platform_sessions::PlatformSessions, SharedDesktop};
use crate::{
    application::{
        send_intent::SendTicket,
        send_ports::{SendFrame, SendPlatform, SendView},
    },
    domain::{
        broadcast::GuestBinding,
        error::{AppError, Result},
        send_intent::{OutgoingSend, SendOutcome, SendState, SendStatus},
        translation::valid_chat_id,
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, mpsc, Arc, Mutex},
    time::Duration,
};

const GUEST: &str = include_str!(concat!(env!("OUT_DIR"), "/send-guest.js"));

pub struct SendGuest {
    platform: Arc<NativePlatform>,
    workspace: SharedDesktop,
    sessions: Arc<PlatformSessions>,
    installed: Mutex<HashMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    chat_id: Option<String>,
    request: Option<OutgoingSend>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Preparation {
    ok: bool,
    code: Option<AppError>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    pending: bool,
    value: Option<SendOutcome>,
}

impl SendGuest {
    pub fn new(
        platform: Arc<NativePlatform>,
        workspace: SharedDesktop,
        sessions: Arc<PlatformSessions>,
    ) -> Self {
        Self {
            platform,
            workspace,
            sessions,
            installed: Mutex::new(HashMap::new()),
        }
    }

    fn evaluate(&self, binding: &GuestBinding, method: &str, arguments: Value) -> Result<Value> {
        // Callers supply only the fixed method names below; arguments are JSON data.
        self.platform
            .evaluate(
                binding,
                format!("window.__geekTauriSend?.{method}(...{arguments}) ?? null"),
            )
            .map_err(|_| AppError::SendIntentChanged)
    }

    fn notify(&self, binding: &GuestBinding, id: &str, attempt: u32, value: Value) -> Result<()> {
        let result = self.evaluate(
            binding,
            "deliver",
            json!([binding.generation, id, attempt, value]),
        )?;
        if result == Value::Bool(true) {
            Ok(())
        } else {
            Err(AppError::SendIntentChanged)
        }
    }
}

impl SendPlatform for SendGuest {
    fn current(&self) -> Result<Option<SendView>> {
        let Some(account) = self
            .workspace
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .visible_account()
            .filter(|account| matches!(account.platform_id.as_str(), "whatsapp" | "whatsapp-pure"))
        else {
            return Ok(None);
        };
        let binding = self
            .sessions
            .binding(&account.id, &account.platform_id)
            .map_err(|_| AppError::SendIntentChanged)?;
        Ok(Some(SendView { account, binding }))
    }

    fn cancellation(&self, binding: &GuestBinding) -> Result<Arc<AtomicBool>> {
        self.sessions
            .presentation_cancellation(binding)
            .map_err(|_| AppError::SendIntentChanged)
    }

    fn configure(&self, view: &SendView, session: Option<&str>, active: bool) -> Result<()> {
        let binding = &view.binding;
        let installed = self
            .installed
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .get(&binding.account_id)
            .is_some_and(|generation| generation == &binding.generation);
        if !active && !installed {
            return Ok(());
        }
        if !installed {
            self.platform
                .install(binding)
                .map_err(|_| AppError::SendIntentUnsupported)?;
        }
        let configuration = json!({ "generation": binding.generation, "sessionGeneration": session,
            "settings": view.account.translation.resolved(), "active": active });
        let source = if installed { "" } else { GUEST };
        let result = self.platform.evaluate(binding, format!(
            "(() => {{ {source}\n return window.__geekTauriSend?.configure({configuration}) === true; }})()"
        )).map_err(|_| AppError::SendIntentChanged)?;
        if result != Value::Bool(true) {
            return Err(AppError::SendIntentUnsupported);
        }
        self.installed
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .insert(binding.account_id.clone(), binding.generation.clone());
        Ok(())
    }

    fn poll(&self, binding: &GuestBinding) -> Result<SendFrame> {
        let frame: Frame =
            serde_json::from_value(self.evaluate(binding, "poll", json!([binding.generation]))?)
                .map_err(|_| AppError::SendIntentInvalid)?;
        if frame
            .chat_id
            .as_deref()
            .is_some_and(|id| !valid_chat_id(id))
        {
            return Err(AppError::SendIntentInvalid);
        }
        if let Some(request) = &frame.request {
            request.validate()?;
        }
        Ok(SendFrame {
            chat_id: frame.chat_id,
            request: frame.request,
        })
    }

    fn prepare(&self, ticket: &SendTicket, text: &str) -> Result<()> {
        ticket.control.check()?;
        let reply: Preparation = serde_json::from_value(self.evaluate(
            &ticket.binding,
            "prepare",
            json!([
                ticket.binding.generation,
                ticket.session_generation,
                ticket.request.id,
                ticket.request.attempt,
                text,
                ticket.translate,
                ticket.request.context,
            ]),
        )?)
        .map_err(|_| AppError::SendIntentState)?;
        if !reply.ok {
            return Err(reply.code.unwrap_or(AppError::SendIntentChanged));
        }
        ticket.control.check()
    }

    fn commit(&self, ticket: &SendTicket, permit: &str) -> SendOutcome {
        let not_submitted = |issue| SendOutcome::NotSubmitted { issue };
        let uncertain = |issue| SendOutcome::Uncertain { issue };
        if let Err(issue) = ticket.control.check() {
            return not_submitted(issue);
        }
        let Ok(original) = self.platform.guest(&ticket.binding) else {
            return not_submitted(AppError::SendIntentChanged);
        };
        let arguments = json!([
            ticket.binding.generation,
            ticket.request.id,
            ticket.request.attempt,
            permit
        ]);
        let (sender, receiver) = mpsc::sync_channel(1);
        let script = format!("window.__geekTauriSend?.commit(...{arguments}) ?? false");
        let queued = self.sessions.enqueue_presented(&ticket.binding, || {
            ticket.control.check()?;
            // Tauri dispatches this script without waiting for its evaluation callback.
            Ok(original.eval_with_callback(script, move |value| {
                let _ = sender.try_send(value);
            }))
        });
        let dispatched = match queued {
            Ok(result) => result,
            Err(issue) => return not_submitted(issue),
        };
        let reply = dispatched
            .map_err(|_| AppError::SendIntentUncertain)
            .and_then(|()| {
                let timeout = ticket.control.remaining()?.min(Duration::from_secs(4));
                let value = receiver
                    .recv_timeout(timeout)
                    .map_err(|_| AppError::SendIntentUncertain)?;
                if value.len() > 1024 {
                    return Err(AppError::SendIntentUncertain);
                }
                serde_json::from_str::<Value>(&value).map_err(|_| AppError::SendIntentUncertain)
            });
        // A lost evaluation callback can follow a successful platform call. Never retry begin.
        let result = match reply {
            Ok(Value::Bool(false)) => not_submitted(AppError::SendIntentChanged),
            Ok(Value::Bool(true)) => loop {
                if let Err(issue) = ticket.control.check() {
                    break uncertain(issue);
                }
                let reply = self
                    .evaluate(&ticket.binding, "read", arguments.clone())
                    .and_then(|value| {
                        serde_json::from_value::<Receipt>(value)
                            .map_err(|_| AppError::SendIntentState)
                    });
                if let Err(issue) = ticket.control.check() {
                    break uncertain(issue);
                }
                match reply {
                    Ok(Receipt {
                        pending: false,
                        value: Some(SendOutcome::NotSubmitted { .. }),
                    }) => break uncertain(AppError::SendIntentUncertain),
                    Ok(Receipt {
                        pending: false,
                        value: Some(outcome),
                    }) => break outcome,
                    Ok(Receipt {
                        pending: true,
                        value: None,
                    }) => {}
                    Ok(_) | Err(_) => break uncertain(AppError::SendIntentUncertain),
                }
                if let Err(issue) = ticket.control.wait(Duration::from_millis(75)) {
                    break uncertain(issue);
                }
            },
            Ok(_) | Err(_) => uncertain(AppError::SendIntentUncertain),
        };
        if !matches!(result, SendOutcome::Confirmed { .. }) {
            // Cleanup targets the held original view, even after its generation is revoked.
            let arguments = json!([
                ticket.binding.generation,
                ticket.request.id,
                ticket.request.attempt
            ]);
            let _ = original.eval(format!("window.__geekTauriSend?.cancel(...{arguments})"));
        }
        result
    }

    fn deliver(&self, binding: &GuestBinding, status: &SendStatus) -> Result<()> {
        let value = match status.state {
            SendState::Confirmed => json!({ "status": "confirmed", "receipt": status.receipt,
                "draftCleared": status.draft_cleared, "retryable": false }),
            SendState::Uncertain => json!({ "status": "uncertain",
                "code": status.issue.unwrap_or(AppError::SendIntentUncertain), "retryable": false }),
            SendState::Failed | SendState::Cancelled => json!({ "status": "notSubmitted",
                "code": status.issue.unwrap_or(AppError::SendIntentState), "retryable": status.retryable }),
            _ => return Ok(()),
        };
        self.notify(binding, &status.id, status.attempt, value)
    }

    fn reject(&self, binding: &GuestBinding, request: &OutgoingSend, error: AppError) {
        let _ = self.notify(
            binding,
            &request.id,
            request.attempt,
            json!({ "status": "notSubmitted", "code": error, "retryable": false }),
        );
    }

    fn cancel(&self, binding: &GuestBinding, id: &str, attempt: u32) {
        let _ = self.evaluate(binding, "cancel", json!([binding.generation, id, attempt]));
    }
}
