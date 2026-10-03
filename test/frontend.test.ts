import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('frontend loads the emitted TypeScript bootstrap as a module', async () => {
  const index = await readFile('frontend/index.html', 'utf8')
  assert.match(index, /<script type="module" src="start\.js"><\/script>/)
  assert.match(index, /<title>Lvce - Tauri<\/title>/)
})

test('Tauri registers the capability needed to close the main window', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
  const capability = JSON.parse(await readFile('src-tauri/capabilities/default.json', 'utf8'))
  assert.deepEqual(config.app.security.capabilities, [capability.identifier])
  assert.ok(capability.permissions.includes('core:window:allow-close'))
})

test('Tauri release builds include webview developer tools', async () => {
  const cargo = await readFile('src-tauri/Cargo.toml', 'utf8')
  const build = await readFile('src-tauri/build.rs', 'utf8')
  const main = await readFile('src-tauri/src/main.rs', 'utf8')
  assert.match(cargo, /features\s*=\s*\["devtools"\]/)
  assert.match(build, /commands\(&\["open_editor", "open_new_window", "toggle_devtools", "is_devtools_open"\]\)/)
  assert.match(main, /generate_handler!\[open_editor, open_new_window, toggle_devtools, is_devtools_open\]/)
  assert.match(main, /async fn open_new_window\(/)
  assert.match(main, /WebviewWindowBuilder::new\(&app, &label, tauri::WebviewUrl::External\(url\)\)/)
  assert.match(main, /permission\("allow-open-new-window"\)/)
  assert.match(main, /permission\("allow-toggle-devtools"\)/)
})

test('Tauri app and window use the product name', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
  assert.equal(config.productName, 'Lvce - Tauri')
  assert.equal(config.app.windows[0].title, 'Lvce - Tauri')
})

test('Tauri grants its remote editor access to the native directory picker', async () => {
  const main = await readFile('src-tauri/src/main.rs', 'utf8')
  const cargo = await readFile('src-tauri/Cargo.toml', 'utf8')
  assert.match(cargo, /^tauri-plugin-dialog\s*=\s*"2"$/m)
  assert.match(main, /\.plugin\(tauri_plugin_dialog::init\(\)\)/)
  assert.match(main, /\.permission\("dialog:allow-open"\)/)
})
