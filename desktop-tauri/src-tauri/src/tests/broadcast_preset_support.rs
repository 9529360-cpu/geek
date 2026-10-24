use crate::{
    application::ports::BroadcastPresetRepository,
    domain::{
        broadcast_presets::BroadcastPresetDocument,
        error::{AppError, Result},
    },
};
use std::sync::{Arc, Mutex};

pub fn id(value: u64) -> String {
    format!("00000000-0000-4000-8000-{value:012x}")
}

#[derive(Default)]
pub struct State {
    pub document: Option<BroadcastPresetDocument>,
    pub saves: usize,
    pub fail: bool,
}

#[derive(Clone, Default)]
pub struct Repository(pub Arc<Mutex<State>>);

impl BroadcastPresetRepository for Repository {
    fn load(&self) -> Result<Option<BroadcastPresetDocument>> {
        Ok(self.0.lock().unwrap().document.clone())
    }

    fn save(&mut self, document: &BroadcastPresetDocument) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        if state.fail {
            return Err(AppError::StoreIo);
        }
        state.saves += 1;
        state.document = Some(document.clone());
        Ok(())
    }
}
