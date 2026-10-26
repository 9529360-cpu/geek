#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(unsafe_op_in_unsafe_fn)]
#[cfg(not(target_os = "windows"))]
compile_error!("The Geek Tauri desktop currently targets Windows only.");

mod application;
mod bootstrap;
mod desktop;
mod domain;
mod infrastructure;
#[cfg(test)]
mod tests;

fn main() {
    bootstrap::run();
}
