//! Narrow foreground send effects. No arbitrary script, URL or account supplied by a page.
use super::send_intent::SendTicket;
use crate::domain::{
    account::Account,
    broadcast::GuestBinding,
    error::Result,
    send_intent::{OutgoingSend, SendOutcome, SendStatus},
};
use std::sync::{atomic::AtomicBool, Arc};

#[derive(Clone)]
pub struct SendView {
    pub account: Account,
    pub binding: GuestBinding,
}

pub struct SendFrame {
    pub chat_id: Option<String>,
    pub request: Option<OutgoingSend>,
}

pub trait SendPlatform: Send + Sync + 'static {
    /// Snapshot only; this method must release the workspace before any guest wait.
    fn current(&self) -> Result<Option<SendView>>;
    fn cancellation(&self, binding: &GuestBinding) -> Result<Arc<AtomicBool>>;
    fn configure(&self, view: &SendView, session: Option<&str>, active: bool) -> Result<()>;
    fn poll(&self, binding: &GuestBinding) -> Result<SendFrame>;
    fn prepare(&self, ticket: &SendTicket, text: &str) -> Result<()>;
    /// Called only after the owner consumes its single-use commit gate.
    fn commit(&self, ticket: &SendTicket, permit: &str) -> SendOutcome;
    fn deliver(&self, binding: &GuestBinding, status: &SendStatus) -> Result<()>;
    fn reject(
        &self,
        binding: &GuestBinding,
        request: &OutgoingSend,
        error: crate::domain::error::AppError,
    );
    fn cancel(&self, binding: &GuestBinding, id: &str, attempt: u32);
}

/// The existing translation/session owners implement this port; it never sends.
pub trait SendTransform: Send + Sync + 'static {
    fn generation(&self) -> Option<String>;
    fn bind(&self, ticket: &mut SendTicket) -> Result<()>;
    fn execute(&self, ticket: &SendTicket) -> Result<String>;
    fn validate(&self, ticket: &SendTicket) -> Result<()>;
}
