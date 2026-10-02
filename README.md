# LVCE Tauri

A desktop prototype that packages the real LVCE Editor server and UI in a Tauri 2 window. Node is included; the installed application does not require Node on PATH.

## Build

Install Node **24.15.0**, Rust stable, and [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/). From a clean checkout:

```sh
npm ci
npm run prepare:lvce
npm run build:runtime
npm test
npm run build -- -- --locked
```

`lvce-source.json` pins the upstream repository and commit. `prepare:lvce` clones that commit and applies the ordered `patches/*.patch` with `git apply --check`; conflicts fail the build. It deliberately refuses to apply patches twice. Preserve any work in `vendor/lvce-editor` before removing that generated checkout to prepare again. Dependency versions come from the pinned upstream lockfile; packaging copies that installed production graph without resolving floating ranges again. Native modules and the included Node binary are built/staged on each target OS, so cross-compilation is not supported.

## Run

Install the artifact from CI or `src-tauri/target/release/bundle`. The default workspace is an empty `workspace` directory in the application's data directory. Set `LVCE_TAURI_WORKSPACE` to an existing directory before starting the application to edit your files. The prototype has its own LVCE configuration, data, cache, and state directories.

Open `smoke.txt` in the explorer, edit it, and press Ctrl+S (Cmd+S on macOS). Verify the saved bytes on disk. Closing the window stops the backend process group, including its Node children.

## Architecture and limits

The bundled local bootstrap uses Tauri's [command/invoke RPC](https://v2.tauri.app/develop/calling-rust/) to start the backend and navigate the native window. Native commands are not granted to the loopback page or any other remote origin. The editor uses LVCE's existing web/server mode: WebSocket JSON RPC to ordinary Node processes, with worker threads for static serving. No Electron utility process, Electron message-port transfer, or Electron executable is used. Browser workers still communicate with their usual browser MessagePorts. This preserves the existing editor transport instead of serializing transferable ports through Tauri.

The Node server binds an OS-assigned loopback port. A random per-launch token is exchanged for an HttpOnly SameSite cookie; HTTP and WebSocket upgrades require that cookie, the expected Host, and a matching Origin when present. Startup and backend RPC waits are bounded. Rust owns the process group (a Windows job on Windows), and kills/reaps it on startup failure and normal application exit. Forced termination of the native host on Unix is not yet a supported cleanup guarantee.

This is the server edition in a native shell, not Electron feature parity. Native menus, desktop dialogs, updater, signing/notarization, and Electron-specific extensions are outside this prototype. Do not interpret a successful build as evidence that every LVCE feature works in WebKit/WebView2.

## Validation

CI builds Debian, Windows NSIS, and macOS app artifacts. Each OS runs authentication and staged-server integration tests. Linux and Windows additionally install/extract the built artifact and use `tauri-driver` to open, edit and save a file, then verify backend exit after closing the window. Failures retain a screenshot, DOM and driver log.

macOS currently has build/backend coverage and the manual smoke flow above. This prototype uses the direct native-driver route; Tauri's [WebDriver documentation](https://v2.tauri.app/develop/tests/webdriver/) distinguishes that route from the newer embedded WebdriverIO service that can support macOS. Integrating that service is not claimed here. The native UI smoke must be run manually on macOS before relying on it there.

No release publication is configured. CI artifacts are unsigned prototypes. Upstream LVCE and Node licenses are included in the runtime; dependency license files are preserved.
