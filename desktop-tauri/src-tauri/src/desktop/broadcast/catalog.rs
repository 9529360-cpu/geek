//! Short-lived account/generation catalog leases, shared by picker and imports.
use super::*;

impl BroadcastDesktop {
    pub fn catalog(&self, account_id: &str) -> Result<BroadcastCatalog> {
        if !valid_uuid(account_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let account = self
            .platform
            .account(account_id)
            .map_err(|_| AppError::AccountUnknown)?;
        let mut result = BroadcastCatalog {
            account_id: account.id.clone(),
            account_name: account.name,
            platform_id: account.platform_id.clone(),
            catalog_id: String::new(),
            ready: false,
            reason_code: None,
            capabilities: CatalogCapabilities::default(),
            chats: Vec::new(),
        };
        let binding = match self
            .platform
            .acquire_binding(account_id, &account.platform_id)
        {
            Ok(binding) => binding,
            Err(code) => {
                result.reason_code = Some(code);
                return Ok(result);
            }
        };
        let value = match self.platform.catalog(&binding) {
            Ok(value) => value,
            Err(code) => {
                result.reason_code = Some(code);
                return Ok(result);
            }
        };
        if !self.sessions.valid(&binding) {
            return Err(AppError::BroadcastUnavailable);
        }
        let native = native_catalog(value)?;
        result.catalog_id = Uuid::new_v4().to_string();
        result.capabilities = native.capabilities;
        result.chats = native.chats;
        result.ready = result.capabilities.text;
        if !result.ready {
            result.reason_code = Some(BroadcastIssue::CapabilityUnavailable);
        }
        self.register_catalog(result, binding, Vec::new(), None)
    }

    pub(super) fn register_catalog(
        &self,
        mut result: BroadcastCatalog,
        binding: GuestBinding,
        additions: Vec<CatalogChat>,
        source_catalog_id: Option<&str>,
    ) -> Result<BroadcastCatalog> {
        if self.stopping.load(Ordering::Acquire) || !self.sessions.valid(&binding) {
            return Err(AppError::BroadcastUnavailable);
        }
        let mut catalogs = self
            .catalogs
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        catalogs.retain(|lease| lease.issued.elapsed() < Duration::from_secs(1800));
        if source_catalog_id.is_some_and(|id| {
            !catalogs.iter().any(|lease| {
                lease.catalog.catalog_id == id
                    && lease.catalog.account_id == result.account_id
                    && lease.binding == binding
            })
        }) {
            return Err(AppError::BroadcastImportUnavailable);
        }
        let imported = catalogs
            .iter()
            .rev()
            .find(|lease| lease.catalog.account_id == result.account_id && lease.binding == binding)
            .map(|lease| lease.imported.clone())
            .unwrap_or_default();
        let native_ids = result.chats.iter().map(|chat| chat.id.clone()).collect();
        // Only previously verified contacts from this exact guest generation
        // survive a refresh. No shell names/IDs or cross-session cache authority.
        let (chats, imported) = merge_catalog_chats(result.chats, imported, additions);
        result.chats = chats;
        result.catalog_id = Uuid::new_v4().to_string();
        if catalogs
            .iter()
            .filter(|lease| lease.catalog.account_id == result.account_id)
            .count()
            >= 2
        {
            if let Some(index) = catalogs
                .iter()
                .position(|lease| lease.catalog.account_id == result.account_id)
            {
                catalogs.remove(index);
            }
        }
        if catalogs.len() >= 40 {
            catalogs.remove(0);
        }
        catalogs.push(CatalogLease {
            catalog: result.clone(),
            binding,
            native_ids,
            imported,
            issued: Instant::now(),
        });
        Ok(result)
    }
}

fn merge_catalog_chats(
    mut native: Vec<CatalogChat>,
    mut imported: Vec<CatalogChat>,
    additions: Vec<CatalogChat>,
) -> (Vec<CatalogChat>, Vec<CatalogChat>) {
    let mut positions: HashMap<_, _> = native
        .iter()
        .enumerate()
        .map(|(index, chat)| (chat.id.clone(), index))
        .collect();
    for chat in additions {
        if let Some(&index) = positions.get(&chat.id) {
            native[index] = chat.clone();
        }
        // Every contact in this successful import is more recent than a cached
        // contact. Updating in place could immediately evict a selected old ID.
        if let Some(index) = imported.iter().position(|old| old.id == chat.id) {
            imported.remove(index);
        }
        imported.push(chat);
    }
    if imported.len() > 2000 {
        imported.drain(..imported.len() - 2000);
    }
    for chat in &mut imported {
        if let Some(&index) = positions.get(&chat.id) {
            *chat = native[index].clone();
        } else {
            positions.insert(chat.id.clone(), native.len());
            native.push(chat.clone());
        }
    }
    (native, imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contact(index: usize, name: &str) -> CatalogChat {
        CatalogChat {
            id: format!("{index}@c.us"),
            name: name.into(),
            real_name: name.into(),
            kind: ChatKind::Contact,
        }
    }

    #[test]
    fn a_full_cache_keeps_every_contact_selected_again_in_the_current_import() {
        let previous: Vec<_> = (1..=2000).map(|index| contact(index, "old")).collect();
        let (catalog, retained) = merge_catalog_chats(
            vec![contact(9999, "native")],
            previous.clone(),
            vec![contact(1, "selected again"), contact(2001, "new")],
        );
        assert_eq!(retained.len(), 2000);
        assert_eq!(catalog.len(), 2001);
        assert_eq!(retained[1998].id, "1@c.us");
        assert_eq!(retained[1999].id, "2001@c.us");
        assert_eq!(
            catalog
                .iter()
                .find(|chat| chat.id == "1@c.us")
                .unwrap()
                .name,
            "selected again"
        );
        assert!(catalog.iter().any(|chat| chat.id == "2001@c.us"));
        assert!(!catalog.iter().any(|chat| chat.id == "2@c.us"));
        assert_eq!(previous[0].name, "old");
        assert_eq!(previous[1].id, "2@c.us");
    }

    #[test]
    fn repeated_refreshes_keep_the_same_bounded_union_and_refresh_authoritative_names() {
        let old = vec![contact(1, "previous name"), contact(2, "external")];
        let mut imported = old.clone();
        for _ in 0..10 {
            let (catalog, retained) =
                merge_catalog_chats(vec![contact(1, "fresh name")], imported, Vec::new());
            assert_eq!(catalog.len(), 2);
            assert_eq!(retained.len(), 2);
            assert_eq!(catalog[0].name, "fresh name");
            assert_eq!(retained[0].name, "fresh name");
            assert_eq!(retained[1].id, "2@c.us");
            imported = retained;
        }
        assert_eq!(old[0].name, "previous name");
    }

    #[test]
    fn successive_full_imports_replace_only_the_old_cache_and_never_mutate_an_old_catalog() {
        let first: Vec<_> = (1..=2000).map(|index| contact(index, "first")).collect();
        let (old_catalog, imported) = merge_catalog_chats(Vec::new(), Vec::new(), first);
        let next: Vec<_> = (2001..=4000).map(|index| contact(index, "next")).collect();
        let (new_catalog, retained) = merge_catalog_chats(Vec::new(), imported, next);
        assert_eq!(new_catalog.len(), 2000);
        assert_eq!(retained.len(), 2000);
        assert!(new_catalog.iter().all(|chat| chat.name == "next"));
        assert_eq!(old_catalog.len(), 2000);
        assert_eq!(old_catalog[0].id, "1@c.us");
        assert_eq!(old_catalog[1999].id, "2000@c.us");
        assert!(old_catalog.iter().all(|chat| chat.name == "first"));
    }
}
