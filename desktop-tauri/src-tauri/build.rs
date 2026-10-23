use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../../ui");
    println!("cargo:rerun-if-changed=../frontend");
    println!("cargo:rerun-if-changed=../scripts/prepare-frontend.cjs");
    let prepared = Command::new("node")
        .arg("../scripts/prepare-frontend.cjs")
        .status()
        .expect("Node.js is required to bundle the original Geek UI");
    assert!(prepared.success(), "Original UI preparation failed");
    println!("cargo:rerun-if-changed=../../src/platform-catalog.cjs");
    println!("cargo:rerun-if-changed=../scripts/export-platforms.cjs");
    let output = Command::new("node")
        .arg("../scripts/export-platforms.cjs")
        .output()
        .expect("Node.js is required to export the canonical Geek platform catalog");
    assert!(output.status.success(), "Platform catalog export failed");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("platforms.json"), output.stdout).expect("write catalog");
    println!("cargo:rerun-if-changed=../guest");
    println!("cargo:rerun-if-changed=../scripts/prepare-platform.cjs");
    println!("cargo:rerun-if-changed=../../src/translation-output-safety.cjs");
    println!("cargo:rerun-if-changed=../../package-lock.json");
    let platform = Command::new("node")
        .arg("../scripts/prepare-platform.cjs")
        .arg(&out)
        .status()
        .expect("Node.js is required to bundle the pinned platform runtime");
    assert!(platform.success(), "Platform runtime preparation failed");
    println!("cargo:rerun-if-changed=../contracts/commands.json");
    println!("cargo:rerun-if-changed=../scripts/command-manifest.cjs");
    let output = Command::new("node")
        .arg("../scripts/command-manifest.cjs")
        .output()
        .expect("Node.js is required to export command permissions");
    assert!(output.status.success(), "Command manifest export failed");
    // AppManifest retains a static slice. Keep this finite, validated build-time
    // inventory alive for the short-lived build process (not the application).
    let names = String::from_utf8(output.stdout).expect("Command manifest must be UTF-8");
    let names: &'static str = Box::leak(names.into_boxed_str());
    let commands: Vec<&'static str> = names.lines().collect();
    let commands: &'static [&'static str] = Box::leak(commands.into_boxed_slice());
    let manifest = tauri_build::AppManifest::new().commands(commands);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("Tauri build configuration failed");
}
