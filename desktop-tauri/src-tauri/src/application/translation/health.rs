use super::TranslationService;
use crate::{
    application::{
        request_control::RequestControl,
        session_ports::{SessionRepository, SessionTransport},
        translation_ports::{TranslationGateway, TranslationHealthGateway},
    },
    domain::{
        error::{AppError, Result},
        translation_health::TranslationHealthSnapshot,
    },
};
use std::time::{Duration, Instant};

impl<R, T, G> TranslationService<R, T, G>
where
    R: SessionRepository,
    T: SessionTransport,
    G: TranslationGateway + TranslationHealthGateway,
{
    /// Same gateway instance as translation, but no session admission, quota,
    /// token cache, message cache or provider request is consulted or changed.
    pub fn health(&self, control: &RequestControl) -> Result<TranslationHealthSnapshot> {
        let control = control.limited(Duration::from_secs(5));
        control.check()?;
        let started = Instant::now();
        let response = self.gateway.health(&control);
        let response = match control.check() {
            Ok(()) => response,
            Err(error) => Err(error),
        };
        match response {
            Ok(healthy) => Ok(TranslationHealthSnapshot::single_primary(
                healthy,
                Some(started.elapsed().as_millis().min(5_000) as u64),
                (!healthy).then_some(AppError::NetworkUnavailable),
            )),
            Err(AppError::TranslationCancelled) => Err(AppError::TranslationCancelled),
            Err(error) => Ok(TranslationHealthSnapshot::single_primary(
                false,
                None,
                Some(error),
            )),
        }
    }
}
