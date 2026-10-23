//! A transform adapter for SendIntent. Identity sends never consult quota or login.
use super::{
    ports::{OutgoingTranslation, TranslationGateway},
    send_intent::SendTicket,
    send_ports::SendTransform,
    session::SessionService,
    session_ports::{SessionRepository, SessionTransport},
    translation::TranslationService,
};
use crate::domain::error::{AppError, Result};
use std::sync::Arc;

pub struct SendTranslation<R: SessionRepository, T: SessionTransport, G: TranslationGateway> {
    session: Arc<SessionService<R, T>>,
    translation: Arc<TranslationService<R, T, G>>,
}

impl<R: SessionRepository, T: SessionTransport, G: TranslationGateway> SendTranslation<R, T, G> {
    pub fn new(
        session: Arc<SessionService<R, T>>,
        translation: Arc<TranslationService<R, T, G>>,
    ) -> Self {
        Self {
            session,
            translation,
        }
    }
}

impl<R: SessionRepository, T: SessionTransport, G: TranslationGateway> SendTransform
    for SendTranslation<R, T, G>
{
    fn generation(&self) -> Option<String> {
        self.session
            .capture_lease()
            .ok()
            .map(|lease| lease.generation)
    }

    fn bind(&self, ticket: &mut SendTicket) -> Result<()> {
        ticket.control.check()?;
        if ticket.translate {
            let lease = self.session.capture_lease()?;
            if ticket.session_generation.as_deref() != Some(lease.generation.as_str()) {
                return Err(AppError::SessionChanged);
            }
            ticket.control = ticket.control.clone().with_cancel(lease.cancel);
        }
        Ok(())
    }

    fn execute(&self, ticket: &SendTicket) -> Result<String> {
        self.validate(ticket)?;
        if !ticket.translate {
            return Ok(ticket.request.text.clone());
        }
        let work = self.translation.prepare_outgoing(
            ticket.account.clone(),
            OutgoingTranslation {
                id: ticket.request.id.clone(),
                chat_id: ticket.request.chat_id.clone(),
                text: ticket.request.text.clone(),
                policy_revision: ticket.request.policy_revision,
            },
            ticket.control.clone(),
        )?;
        if ticket.session_generation.as_deref() != Some(work.lease.generation.as_str()) {
            return Err(AppError::SessionChanged);
        }
        self.translation.execute_outgoing(&work)
    }

    fn validate(&self, ticket: &SendTicket) -> Result<()> {
        ticket.control.check()?;
        if ticket.translate {
            let lease = self.session.capture_lease()?;
            if ticket.session_generation.as_deref() != Some(lease.generation.as_str()) {
                return Err(AppError::SessionChanged);
            }
        }
        Ok(())
    }
}
