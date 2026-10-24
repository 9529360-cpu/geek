use super::request_control::RequestControl;
use crate::domain::{
    error::Result,
    session::{LoginPayload, SessionDocument, SessionRefresh},
};

pub trait SessionRepository: Send + 'static {
    fn load(&self) -> Result<Option<SessionDocument>>;
    fn save(&mut self, document: &SessionDocument) -> Result<()>;
}

/// Fixed authentication operations; no caller-supplied URL or general HTTP port.
pub trait SessionTransport: Send + Sync + 'static {
    fn login(&self, email: &str, password: &str, control: &RequestControl) -> Result<LoginPayload>;
    fn refresh(&self, token: &str, control: &RequestControl) -> Result<SessionRefresh>;
}

pub trait SessionClock: Send + Sync + 'static {
    fn now_ms(&self) -> u64;
}

pub struct SystemSessionClock(std::time::Instant);

impl Default for SystemSessionClock {
    fn default() -> Self {
        Self(std::time::Instant::now())
    }
}

impl SessionClock for SystemSessionClock {
    fn now_ms(&self) -> u64 {
        self.0.elapsed().as_millis() as u64
    }
}
