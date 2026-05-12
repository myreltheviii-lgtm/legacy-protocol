// src-tauri/src/lib.rs
//
// Tauri application backend.
// Spawns both sidecars on startup:
//   signing-service — HTTP server on 127.0.0.1:7647 (Cloak / ZK operations)
//   qvac-sidecar    — HTTP server on 127.0.0.1:7648 (LLM risk analysis)
//
// Both sidecars are Node.js processes bundled as external binaries.
// The frontend polls /health on each until ready (sidecar-boot.ts).
// Child handles are managed by Tauri state so they stay alive for the
// entire process lifetime and are cleaned up on app exit.

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// Dummy command — satisfies tauri::generate_handler! requirement.
/// Actual sidecar health checks are done by the frontend via fetch().
#[tauri::command]
fn ping() -> &'static str {
    "ok"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
            let handle = app.handle().clone();

            // ── Spawn signing-service ────────────────────────────────────────
            let (_, signing_child) = handle
                .shell()
                .sidecar("signing-service")
                .map_err(|e| {
                    eprintln!("[guardian] Failed to create signing-service sidecar: {e}");
                    e
                })?
                .spawn()
                .map_err(|e| {
                    eprintln!("[guardian] Failed to spawn signing-service: {e}");
                    e
                })?;

            // Keep the child handle alive for the process lifetime.
            app.manage(signing_child);

            // ── Spawn qvac-sidecar ───────────────────────────────────────────
            let (_, qvac_child) = handle
                .shell()
                .sidecar("qvac-sidecar")
                .map_err(|e| {
                    eprintln!("[guardian] Failed to create qvac-sidecar: {e}");
                    e
                })?
                .spawn()
                .map_err(|e| {
                    eprintln!("[guardian] Failed to spawn qvac-sidecar: {e}");
                    e
                })?;

            app.manage(qvac_child);
            } // end #[cfg(desktop)]

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
