use super::{
    account::valid_name,
    error::{AppError, Result},
};

pub const MAX_BATCH: u8 = 10;

/// Preserve the original application center naming rule without partial writes.
pub fn names(base: &str, platform: &str, existing: usize, count: u8) -> Result<Vec<String>> {
    if !(1..=MAX_BATCH).contains(&count) {
        return Err(AppError::BatchInvalid);
    }
    let base = base.trim();
    if !base.is_empty() && !valid_name(base) {
        return Err(AppError::NameInvalid);
    }
    (0..usize::from(count))
        .map(|index| {
            let name = if base.is_empty() {
                format!("{platform} {}", existing + index + 1)
            } else if count == 1 {
                base.to_owned()
            } else {
                format!("{base} {}", index + 1)
            };
            if valid_name(&name) {
                Ok(name)
            } else {
                Err(AppError::NameInvalid)
            }
        })
        .collect()
}
