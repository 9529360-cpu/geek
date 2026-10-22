use crate::domain::{
    account::Account, document::Document, error::Result, navigation::NavigationPolicy,
};

/// Only the repository owns serialization, encryption, locks and atomic I/O.
/// A failed save must leave the previous durable document authoritative.
pub trait AccountRepository {
    fn load(&self) -> Result<Option<Document>>;
    fn save(&mut self, document: &Document) -> Result<()>;
}

/// Native side effects. Account IDs are already validated by the use-case owner.
/// This port exposes no arbitrary paths, scripts, URLs or privileged page bridge.
pub trait DesktopHost {
    fn is_open(&self, id: &str) -> bool;
    fn open(&mut self, account: &Account, navigation: NavigationPolicy) -> Result<()>;
    fn fit(&mut self, id: &str) -> Result<()>;
    fn show(&mut self, id: &str) -> Result<()>;
    fn hide(&mut self, id: &str) -> Result<()>;
    fn focus(&mut self, id: &str) -> Result<()>;
    fn close(&mut self, id: &str) -> Result<()>;
    fn reload(&mut self, id: &str) -> Result<()>;
    fn tray_available(&self) -> bool;
    fn publish_close_to_tray(&self, enabled: bool);
}
