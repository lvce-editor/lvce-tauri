import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

test('staged native OAuth bridge launches the installed process, receives a callback and disposes listeners', async () => {
  const parts = resolve('src-tauri/resources/node_modules/@lvce-editor/shared-process/src/parts')
  const bridge = await import(pathToFileURL(`${parts}/HandleMessagePortForAuthProcess/HandleMessagePortForAuthProcess.js`).href)
  const authProcess = await import(pathToFileURL(`${parts}/AuthProcess/AuthProcess.js`).href)
  const first = randomUUID()
  const second = randomUUID()
  try {
    const port = await bridge.createOAuthServer(first, '<p>Signed in</p>', '<p>Cancelled</p>')
    assert.equal(typeof port, 'number')
    const code = bridge.getOAuthCode(first)
    const response = await fetch(`http://localhost:${port}/callback?code=test-authorization-code`)
    assert.equal(await response.text(), '<p>Signed in</p>')
    assert.equal(await code, 'test-authorization-code')
    await bridge.disposeOAuthServer(first)
    await assert.rejects(fetch(`http://localhost:${port}/callback`))

    const secondPort = await bridge.createOAuthServer(second, 'success', 'cancelled')
    const pendingCode = assert.rejects(bridge.getOAuthCode(second), /disposed/)
    await bridge.disposeOAuthServer(second)
    await pendingCode
    await assert.rejects(fetch(`http://localhost:${secondPort}/callback`))
  } finally {
    await bridge.disposeOAuthServer(first).catch(() => {})
    await bridge.disposeOAuthServer(second).catch(() => {})
    if (authProcess.state.ipc) {
      const ipc = await authProcess.state.ipc
      authProcess.state.ipc = undefined
      await ipc.dispose()
    }
  }
})
