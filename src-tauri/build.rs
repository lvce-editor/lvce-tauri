fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["open_editor", "open_new_window", "toggle_devtools", "is_devtools_open"])
        )
    ).expect("Failed to build Tauri application");
}
