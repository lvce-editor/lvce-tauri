import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('frontend loads the emitted TypeScript bootstrap as a module', async () => {
  const index = await readFile('frontend/index.html', 'utf8')
  assert.match(index, /<script type="module" src="start\.js"><\/script>/)
})

test('Tauri registers the capability needed to close the main window', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
  const capability = JSON.parse(await readFile('src-tauri/capabilities/default.json', 'utf8'))
  assert.deepEqual(config.app.security.capabilities, [capability.identifier])
  assert.ok(capability.permissions.includes('core:window:allow-close'))
})
