use crate::{
    desktop::crash_record::{prune_panic_records, write_panic_location},
    domain::rate_limit::SlidingWindow,
};
use std::{
    fs,
    time::{Duration, SystemTime},
};

#[test]
fn panic_allowance_is_two_per_window_and_resets_when_the_clock_moves_backwards() {
    let mut gate = SlidingWindow::new(2, 100);
    assert!(gate.allow(0));
    assert!(gate.allow(10));
    assert!(!gate.allow(20));
    assert!(gate.allow(111));
    assert!(gate.allow(112));
    assert!(!gate.allow(113));
    assert!(gate.allow(50));
    gate.reset();
    assert!(gate.allow(50));
}

#[test]
fn panic_notes_keep_only_a_source_name_and_the_five_newest_files() {
    let dir = std::env::temp_dir().join(format!("geek-panic-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    assert!(write_panic_location(
        &dir,
        Some(r"C:\Users\secret\chat-body.rs"),
        Some(42)
    ));
    let notes: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(notes.len(), 1);
    let body = fs::read_to_string(&notes[0]).unwrap();
    assert_eq!(body, "location=chat-body.rs:42\n");
    assert!(!body.contains("secret"));
    assert!(!body.contains("panic payload"));
    fs::remove_file(&notes[0]).unwrap();
    for index in 0..7 {
        let path = dir.join(format!("panic-{index}.txt"));
        fs::write(&path, "location=rate_limit.rs:1\n").unwrap();
        let when = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + index);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }
    fs::write(dir.join("keep-me.txt"), "not a dump").unwrap();
    fs::write(dir.join("panic-old.dmp"), "native").unwrap();
    assert_eq!(prune_panic_records(&dir, 5), 2);
    assert!(dir.join("keep-me.txt").exists());
    assert!(dir.join("panic-old.dmp").exists());
    assert!(!dir.join("panic-0.txt").exists());
    assert!(!dir.join("panic-1.txt").exists());
    assert!(dir.join("panic-6.txt").exists());
    let _ = fs::remove_dir_all(&dir);
}
