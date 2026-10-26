//! Local panic notes. The file stores only a source name and line. The panic
//! payload is never written and nothing is uploaded.
use crate::domain::rate_limit::SlidingWindow;
use std::{
    fs,
    io::Write,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};

const KEEP: usize = 5;
const MAX_NOTES: u32 = 2;
const WINDOW_MS: u64 = 5 * 60 * 1000;
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn install(root: &Path) {
    let dir = root.join("crash-dumps");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = prune_panic_records(&dir, KEEP);
    let limiter = Arc::new(Mutex::new(SlidingWindow::new(MAX_NOTES, WINDOW_MS)));
    let started = Instant::now();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let now = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        let location = info.location();
        let allowed = limiter.lock().map_or(false, |mut gate| gate.allow(now));
        if allowed {
            let file = location.map(|item| item.file());
            let line = location.map(|item| item.line());
            let _ = write_panic_location(&dir, file, line);
        }
        previous(info);
    }));
}

pub(crate) fn write_panic_location(dir: &Path, file: Option<&str>, line: Option<u32>) -> bool {
    let name = sanitize_location(file.unwrap_or("unknown"));
    let line = line.unwrap_or(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis();
    let path = dir.join(format!("panic-{stamp}-{sequence}.txt"));
    let mut body = format!("location={name}:{line}\n");
    if body.len() > 120 {
        body = "location=unknown:0\n".to_string();
    }
    let mut file = match fs::File::create(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    file.write_all(body.as_bytes()).is_ok()
}

pub(crate) fn prune_panic_records(dir: &Path, keep: usize) -> usize {
    let mut notes = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("panic-") || !name.ends_with(".txt") {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) else {
            continue;
        };
        notes.push((modified, path));
    }
    notes.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.cmp(&left.1)));
    let mut removed = 0;
    for (_, path) in notes.into_iter().skip(keep) {
        if fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn sanitize_location(file: &str) -> String {
    let base = file.rsplit(['/', '\\']).next().unwrap_or("unknown");
    let cleaned: String = base
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        .take(80)
        .collect();
    if cleaned.is_empty() {
        "unknown".to_string()
    } else {
        cleaned
    }
}
