//! LINE accounts load the unpacked extension through WebView2.
//! The directory contains only that extension. Other account profiles stay extension-free.
use crate::domain::error::{AppError, Result};
use std::{fs, path::Path, path::PathBuf};

const EXTENSION_DIR: &str = "line-3.5.1";

pub fn prepare_line_extension_host(root: &Path) -> Result<PathBuf> {
    let source = locate_line_extension().ok_or(AppError::WebviewFailed)?;
    let host = root.join("line-extension-host");
    fs::create_dir_all(&host).map_err(|_| AppError::WebviewFailed)?;
    let link = host.join(EXTENSION_DIR);
    if link.symlink_metadata().is_ok() {
        return if same_target(&link, &source) {
            only_extension_child(&host)?;
            Ok(host)
        } else {
            Err(AppError::WebviewFailed)
        };
    }
    link_dir(&source, &link).map_err(|_| AppError::WebviewFailed)?;
    only_extension_child(&host)?;
    Ok(host)
}

fn locate_line_extension() -> Option<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources/extensions/line-3.5.1")
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources/extensions/line-3.5.1"));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.join("manifest.json").is_file())
}

fn same_target(link: &Path, source: &Path) -> bool {
    let Ok(current) = fs::read_link(link) else {
        return false;
    };
    let current = current.canonicalize().unwrap_or(current);
    let source = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    current == source
}

fn only_extension_child(host: &Path) -> Result<()> {
    let names = fs::read_dir(host)
        .map_err(|_| AppError::WebviewFailed)?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| AppError::WebviewFailed)?;
    if names.len() != 1 || names[0].file_name() != EXTENSION_DIR {
        return Err(AppError::WebviewFailed);
    }
    Ok(())
}

#[cfg(windows)]
fn link_dir(source: &Path, link: &Path) -> std::io::Result<()> {
    if std::os::windows::fs::symlink_dir(source, link).is_ok() {
        return Ok(());
    }
    let link_text = link.to_string_lossy().into_owned();
    let source_text = source.to_string_lossy().into_owned();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J", &link_text, &source_text])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other("line extension junction failed"))
    }
}

#[cfg(unix)]
fn link_dir(source: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(not(any(windows, unix)))]
fn link_dir(source: &Path, link: &Path) -> std::io::Result<()> {
    let _ = (source, link);
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "line extension link",
    ))
}
