#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
use backend::BackendProcess;
use std::{
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::Manager;

static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct Backend(Mutex<BackendState>);

#[derive(Default)]
struct BackendState {
    process: Option<BackendProcess>,
    url: Option<String>,
}

impl Backend {
    fn stop(&self) {
        let mut state = self.0.lock().unwrap();
        state.url = None;
        drop(state.process.take());
    }

    fn url(&self) -> Result<String, String> {
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .url
            .clone()
            .ok_or_else(|| "Backend is not running".into())
    }
}
impl Drop for Backend { fn drop(&mut self) { self.stop(); } }

#[tauri::command]
async fn open_editor(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    let handle = app.clone();
    let url = tauri::async_runtime::spawn_blocking(move || start_backend(&handle)).await.map_err(|e| e.to_string())??;
    let navigation = (|| -> Result<(), String> {
        let url: tauri::Url = url.parse().map_err(|e| format!("Invalid backend URL: {e}"))?;
        add_editor_capability(&app, window.label(), &url)?;
        window.navigate(url).map_err(|e| e.to_string())
    })();
    if let Err(error) = navigation {
        app.state::<Backend>().stop();
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    let url: tauri::Url = app
        .state::<Backend>()
        .url()?
        .parse()
        .map_err(|e| format!("Invalid backend URL: {e}"))?;
    let label = format!("editor-{}", NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed));
    add_editor_capability(&app, &label, &url)?;
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(url))
        .title("Lvce - Tauri")
        .inner_size(1200.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn add_editor_capability(app: &tauri::AppHandle, label: &str, url: &tauri::Url) -> Result<(), String> {
    // The editor is served by our ephemeral HTTP backend, not the bundled origin.
    // Grant editor commands only to this window and this backend's exact port.
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return Err("Unexpected backend origin".into());
    }
    let capability_id = if label == "main" {
        "editor-window-close".to_string()
    } else {
        format!("editor-window-{label}")
    };
    app.add_capability(
        tauri::ipc::CapabilityBuilder::new(capability_id)
            .local(false)
            .window(label)
            .remote(format!("{}/*", url.origin().ascii_serialization()))
            .permission("core:window:allow-close")
            .permission("allow-open-new-window")
            .permission("allow-toggle-devtools")
            .permission("allow-is-devtools-open")
            .permission("dialog:allow-open"),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
fn is_devtools_open(window: tauri::WebviewWindow) -> bool {
    window.is_devtools_open()
}

fn start_backend(app: &tauri::AppHandle) -> Result<String, String> {
    diagnostic("Starting Node backend");
    let state = app.state::<Backend>();
    let mut owned = state.0.lock().map_err(|e| e.to_string())?;
    if owned.process.is_some() { return Err("Backend already started".into()); }
    let root = app.path().resource_dir().map_err(|e| e.to_string())?.join("runtime");
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    let workspace = std::env::var_os("LVCE_TAURI_WORKSPACE").map(std::path::PathBuf::from).unwrap_or_else(|| profile.join("workspace"));
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let mut command = Command::new(root.join(if cfg!(windows) { "node.exe" } else { "node" }));
    // Tauri may return a Windows verbatim resource path, which Node's entry-point
    // resolver rejects. Resolve the script from the child's runtime directory.
    command.arg("launch.js").current_dir(&root)
        .env("LVCE_TAURI_WORKSPACE", workspace)
        .env("XDG_CONFIG_HOME", profile.join("config"))
        .env("XDG_DATA_HOME", profile.join("data"))
        .env("XDG_CACHE_HOME", profile.join("cache"))
        .env("XDG_STATE_HOME", profile.join("state"));
    let (child, url) = BackendProcess::start(&mut command, Duration::from_secs(60))?;
    if let Some(path) = std::env::var_os("LVCE_TAURI_PID_FILE") {
        std::fs::write(path, child.id().to_string()).map_err(|error| error.to_string())?;
    }
    diagnostic("Node backend ready");
    owned.process = Some(child);
    owned.url = Some(url.clone());
    Ok(url)
}

fn diagnostic(message: &str) {
    if let Some(path) = std::env::var_os("LVCE_TAURI_DIAGNOSTICS") {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{message}");
        }
    }
}

fn main() {
    diagnostic("Native host started");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Backend::default())
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                diagnostic(&format!("Native window event: {event:?}"));
                let has_other_windows = window
                    .app_handle()
                    .webview_windows()
                    .values()
                    .any(|candidate| candidate.label() != window.label());
                if has_other_windows {
                    diagnostic("Backend retained for surviving native windows");
                } else {
                    window.app_handle().state::<Backend>().stop();
                    diagnostic("Backend stopped after native window close");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![open_editor, open_new_window, toggle_devtools, is_devtools_open])
        .build(tauri::generate_context!()).unwrap_or_else(|error| {
            diagnostic(&format!("Failed to build Tauri application: {error}"));
            panic!("Failed to build Tauri application: {error}");
        });
    diagnostic("Native window built");
    app.run(|app, event| {
        match event {
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                app.state::<Backend>().stop()
            }
            _ => {}
        }
    });
}
