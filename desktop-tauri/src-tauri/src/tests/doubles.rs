use crate::{
    application::{
        accounts::Accounts,
        ports::{AccountRepository, DesktopHost},
        workspace::Workspace,
    },
    domain::{
        account::Account,
        document::Document,
        error::{AppError, Result},
        navigation::NavigationPolicy,
        proxy::ProxyConfig,
    },
    infrastructure::catalog,
};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub struct Disk {
    pub document: Option<Document>,
    pub fail_save: bool,
    pub saves: usize,
}

#[derive(Clone, Default)]
pub struct MemoryRepository(pub Arc<Mutex<Disk>>);

impl AccountRepository for MemoryRepository {
    fn load(&self) -> Result<Option<Document>> {
        Ok(self.0.lock().unwrap().document.clone())
    }
    fn save(&mut self, document: &Document) -> Result<()> {
        let mut disk = self.0.lock().unwrap();
        if disk.fail_save {
            return Err(AppError::StoreIo);
        }
        disk.document = Some(document.clone());
        disk.saves += 1;
        Ok(())
    }
}

#[derive(Default)]
pub struct HostState {
    pub opened: HashSet<String>,
    pub visible: HashSet<String>,
    pub fail: Option<(&'static str, String)>,
    pub calls: Vec<(String, String)>,
    pub tray: bool,
    pub close_to_tray: bool,
    pub routes: HashMap<String, ProxyConfig>,
    pub close_pending: bool,
}

#[derive(Clone, Default)]
pub struct FakeHost(pub Arc<Mutex<HostState>>);

impl FakeHost {
    fn action(
        &mut self,
        action: &str,
        id: &str,
        update: impl FnOnce(&mut HostState),
    ) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        state.calls.push((action.into(), id.into()));
        if state
            .fail
            .as_ref()
            .is_some_and(|(op, owner)| *op == action && owner == id)
        {
            return Err(AppError::WebviewFailed);
        }
        update(&mut state);
        Ok(())
    }
}

impl DesktopHost for FakeHost {
    fn is_open(&self, id: &str) -> bool {
        self.0.lock().unwrap().opened.contains(id)
    }
    fn open(&mut self, account: &Account, _: NavigationPolicy) -> Result<()> {
        self.action("open", &account.id, |s| {
            s.opened.insert(account.id.clone());
            s.routes.insert(account.id.clone(), account.proxy.clone());
        })
    }
    fn fit(&mut self, id: &str) -> Result<()> {
        self.action("fit", id, |_| {})
    }
    fn show(&mut self, id: &str) -> Result<()> {
        self.action("show", id, |s| {
            s.visible.insert(id.into());
        })
    }
    fn hide(&mut self, id: &str) -> Result<()> {
        self.action("hide", id, |s| {
            s.visible.remove(id);
        })
    }
    fn focus(&mut self, id: &str) -> Result<()> {
        self.action("focus", id, |_| {})
    }
    fn close(&mut self, id: &str) -> Result<()> {
        self.action("close", id, |s| {
            if s.close_pending {
                return;
            }
            s.opened.remove(id);
            s.visible.remove(id);
        })
    }
    fn reload(&mut self, id: &str) -> Result<()> {
        self.action("reload", id, |_| {})
    }
    fn tray_available(&self) -> bool {
        self.0.lock().unwrap().tray
    }
    fn publish_close_to_tray(&self, enabled: bool) {
        self.0.lock().unwrap().close_to_tray = enabled;
    }
}

pub type TestDesktop = Workspace<MemoryRepository, FakeHost>;

pub fn fixture() -> (TestDesktop, MemoryRepository, FakeHost, String, String) {
    let repository = MemoryRepository::default();
    let host = FakeHost::default();
    let accounts = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
    let mut desktop = Workspace::new(accounts, host.clone());
    desktop.create("A", "whatsapp", None, Default::default()).unwrap();
    let snapshot = desktop.create("B", "whatsapp", None, Default::default()).unwrap();
    let a = snapshot.accounts[0].id.clone();
    let b = snapshot.accounts[1].id.clone();
    (desktop, repository, host, a, b)
}
