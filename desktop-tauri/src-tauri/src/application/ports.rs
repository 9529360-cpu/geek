pub use super::request_control::RequestControl;
pub use super::session_ports::{SessionRepository, SessionTransport};
pub use super::translation_ports::{
    OutgoingTranslation, SystemTranslationCacheClock, TranslationCacheClock,
    TranslationCacheRepository, TranslationGateway, TranslationHealthGateway, TranslationIntent,
    TranslationReply, TranslationRequest, TranslationToken,
};
use crate::domain::{
    account::Account, document::Document, error::Result, navigation::NavigationPolicy,
    presentation::Viewport,
};

/// Native attachment inspection is cancellable, bounded and never runs under an owner lock.
pub trait BroadcastAttachmentIo: Send + Sync {
    fn inspect(
        &self,
        path: &std::path::Path,
        as_document: bool,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<crate::domain::broadcast_attachment::AttachmentFile>;
    fn open_verified(
        &self,
        source: &crate::domain::broadcast_attachment::BroadcastAttachmentSource,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Box<dyn BroadcastAttachmentRead>>;
}

/// Owns one native read handle until EOF/drop. None means final integrity passed.
pub trait BroadcastAttachmentRead: Send {
    fn next_chunk(
        &mut self,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>>;
}

/// Only the repository owns serialization, encryption, locks and atomic I/O.
/// A failed save must leave the previous durable document authoritative.
pub trait AccountRepository {
    fn load(&self) -> Result<Option<Document>>;
    fn save(&mut self, document: &Document) -> Result<()>;
}

/// Independent job storage; the process-wide account repository owns instance.lock.
pub trait BroadcastRepository: Send + 'static {
    fn load(&self) -> Result<Option<crate::domain::broadcast::BroadcastDocument>>;
    fn save(&mut self, document: &crate::domain::broadcast::BroadcastDocument) -> Result<()>;
}

/// Preset storage shares the existing process lock. Failed saves preserve the old file.
pub trait BroadcastPresetRepository: Send + 'static {
    fn load(&self) -> Result<Option<crate::domain::broadcast_presets::BroadcastPresetDocument>>;
    fn save(
        &mut self,
        document: &crate::domain::broadcast_presets::BroadcastPresetDocument,
    ) -> Result<()>;
}

/// Addressed semantic operations only. Implementations must bound every native wait.
pub trait BroadcastPlatform: Send + Sync + 'static {
    fn acquire_binding(
        &self,
        account_id: &str,
        platform_id: &str,
    ) -> std::result::Result<
        crate::domain::broadcast::GuestBinding,
        crate::domain::broadcast::BroadcastIssue,
    >;
    fn local_hour(
        &self,
        binding: &crate::domain::broadcast::GuestBinding,
    ) -> std::result::Result<u8, crate::domain::broadcast::BroadcastIssue>;
    /// Call control.try_begin_commit() immediately before the one outbound mutation.
    /// A submitted timeout/exception is Uncertain, never NotSubmitted or a retry.
    fn dispatch(
        &self,
        binding: &crate::domain::broadcast::GuestBinding,
        request: &crate::domain::broadcast::DispatchRequest,
        control: &super::broadcast::DispatchControl,
    ) -> crate::domain::broadcast::DispatchOutcome;
}

/// Native side effects. Account IDs are already validated by the use-case owner.
/// This port exposes no arbitrary paths, scripts, URLs or privileged page bridge.
pub trait DesktopHost {
    fn set_viewport(&mut self, viewport: Viewport);
    fn is_open(&self, id: &str) -> bool;
    fn open(&mut self, account: &Account, navigation: NavigationPolicy) -> Result<()>;
    fn fit(&mut self, id: &str) -> Result<()>;
    fn show(&mut self, id: &str) -> Result<()>;
    fn hide(&mut self, id: &str) -> Result<()>;
    fn focus(&mut self, id: &str) -> Result<()>;
    fn focus_shell(&mut self) -> Result<()>;
    fn close(&mut self, id: &str) -> Result<()>;
    fn reload(&mut self, id: &str) -> Result<()>;
    fn tray_available(&self) -> bool;
    fn publish_close_to_tray(&self, enabled: bool);
}
