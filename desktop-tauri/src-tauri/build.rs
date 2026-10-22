use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../../src/platform-catalog.cjs");
    println!("cargo:rerun-if-changed=../scripts/export-platforms.cjs");
    let output = Command::new("node")
        .arg("../scripts/export-platforms.cjs")
        .output()
        .expect("Node.js is required to export the canonical Geek platform catalog");
    assert!(output.status.success(), "Platform catalog export failed");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("platforms.json"), output.stdout).expect("write catalog");
    let manifest = tauri_build::AppManifest::new().commands(&[
        "desktop_snapshot", "account_create", "account_activate",
        "account_close", "account_reload", "desktop_layout", "account_rename",
        "account_set_archived", "desktop_settings",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("Tauri build configuration failed");
}
