use crate::{
    application::{session::SessionService, translation::TranslationService},
    infrastructure::{service_api::NativeApi, session_repository::EncryptedSessionRepository},
};

pub type NativeSession = SessionService<EncryptedSessionRepository, NativeApi>;
pub type NativeTranslation = TranslationService<EncryptedSessionRepository, NativeApi, NativeApi>;
