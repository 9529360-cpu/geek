//! Bounded recipient reads and atomic CSV writes. No renderer-provided paths.
use crate::domain::error::{AppError, Result};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};

const IMPORT_BYTES: u64 = 5 * 1024 * 1024;

pub fn read_import(path: &Path) -> Result<Vec<u8>> {
    if !path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("csv") || s.eq_ignore_ascii_case("txt"))
    {
        return Err(AppError::BroadcastImportInvalid);
    }
    let file = File::open(path).map_err(|_| AppError::BroadcastImportUnavailable)?;
    let metadata = file
        .metadata()
        .map_err(|_| AppError::BroadcastImportUnavailable)?;
    if !metadata.is_file() {
        return Err(AppError::BroadcastImportInvalid);
    }
    if metadata.len() > IMPORT_BYTES {
        return Err(AppError::BroadcastImportLimit);
    }
    // The same opened handle supplies metadata and bytes. A growing file still
    // cannot allocate beyond the limit or silently produce a truncated import.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(IMPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::BroadcastImportUnavailable)?;
    if bytes.len() as u64 > IMPORT_BYTES {
        return Err(AppError::BroadcastImportLimit);
    }
    Ok(bytes)
}

pub fn write_report(path: &Path, csv: &str) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or(AppError::BroadcastExportFailed)?;
    // Finish and flush beside the destination before atomic replacement. A
    // failed write leaves the previously saved report intact.
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| AppError::BroadcastExportFailed)?;
    file.write_all(csv.as_bytes())
        .map_err(|_| AppError::BroadcastExportFailed)?;
    file.as_file()
        .sync_all()
        .map_err(|_| AppError::BroadcastExportFailed)?;
    file.persist(path)
        .map_err(|_| AppError::BroadcastExportFailed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recipient_reader_is_bounded_and_rejects_non_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("contacts.CSV");
        std::fs::write(&path, "手机号\n+60123456789").unwrap();
        assert_eq!(
            read_import(&path).unwrap(),
            "手机号\n+60123456789".as_bytes()
        );
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(IMPORT_BYTES + 1)
            .unwrap();
        assert_eq!(read_import(&path), Err(AppError::BroadcastImportLimit));
        assert_eq!(
            read_import(&dir.path().join("contacts.xlsx")),
            Err(AppError::BroadcastImportInvalid)
        );
        let folder = dir.path().join("folder.csv");
        std::fs::create_dir(&folder).unwrap();
        assert!(read_import(&folder).is_err());
    }

    #[test]
    fn csv_replacement_is_complete_and_failure_preserves_destination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.csv");
        std::fs::write(&path, "old").unwrap();
        write_report(&path, "\u{feff}联系人,聊天ID\r\n新,1@lid\r\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "\u{feff}联系人,聊天ID\r\n新,1@lid\r\n"
        );
        let destination_dir = dir.path().join("existing.csv");
        std::fs::create_dir(&destination_dir).unwrap();
        std::fs::write(destination_dir.join("keep"), "original").unwrap();
        assert_eq!(
            write_report(&destination_dir, "new"),
            Err(AppError::BroadcastExportFailed)
        );
        assert_eq!(
            std::fs::read_to_string(destination_dir.join("keep")).unwrap(),
            "original"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
