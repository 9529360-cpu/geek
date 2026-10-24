//! Native-path-only bounded JSON input and atomic portable backup output.
use crate::domain::{
    account_backup::MAX_BACKUP_BYTES,
    error::{AppError, Result},
};
use std::{fs::File, io::Read, path::Path};

pub fn read_backup(path: &Path) -> Result<Vec<u8>> {
    if !path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        return Err(AppError::BackupInvalid);
    }
    let file = File::open(path).map_err(|_| AppError::BackupFileFailed)?;
    let metadata = file.metadata().map_err(|_| AppError::BackupFileFailed)?;
    if !metadata.is_file() {
        return Err(AppError::BackupInvalid);
    }
    if metadata.len() > MAX_BACKUP_BYTES as u64 {
        return Err(AppError::BackupLimit);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_BACKUP_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::BackupFileFailed)?;
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err(AppError::BackupLimit);
    }
    Ok(bytes)
}

pub fn write_backup(path: &Path, content: &str) -> Result<()> {
    if content.len() > MAX_BACKUP_BYTES {
        return Err(AppError::BackupLimit);
    }
    super::broadcast_files::write_export(path, content, AppError::BackupFileFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_backup_files_are_bounded_and_failed_replacement_preserves_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.JSON");
        write_backup(&path, "{\"name\":\"测试\"}").unwrap();
        assert_eq!(
            read_backup(&path).unwrap(),
            "{\"name\":\"测试\"}".as_bytes()
        );
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_BACKUP_BYTES as u64 + 1)
            .unwrap();
        assert_eq!(read_backup(&path), Err(AppError::BackupLimit));
        assert_eq!(
            read_backup(&dir.path().join("backup.txt")),
            Err(AppError::BackupInvalid)
        );
        let folder = dir.path().join("destination.json");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("keep"), "original").unwrap();
        assert_eq!(write_backup(&folder, "{}"), Err(AppError::BackupFileFailed));
        assert_eq!(
            std::fs::read_to_string(folder.join("keep")).unwrap(),
            "original"
        );
        assert!(read_backup(&folder).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
