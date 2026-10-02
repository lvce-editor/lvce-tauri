import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createAuth } from '../runtime/auth.mjs'
const token = 'a'.repeat(64)
const auth = createAuth(token)
const request = (headers = {}) => ({ headers: { host: '127.0.0.1:3456', ...headers } })
const cookie = `lvce-tauri-${token.slice(0, 16)}=${token}`
test('rejects unauthenticated requests, wrong hosts and cross-origin websocket upgrades', () => {
  assert.equal(auth.authorize(request(), 3456), false)
  assert.equal(auth.authorize(request({ cookie }), 3456), true)
  assert.equal(auth.authorize(request({ cookie, host: 'evil.example:3456' }), 3456), false)
  assert.equal(auth.authorize(request({ cookie, origin: 'https://evil.example' }), 3456), false)
  assert.equal(auth.authorize(request({ cookie, origin: 'http://127.0.0.1:3456' }), 3456), true)
  assert.equal(auth.authorize(request({ cookie: `${cookie}b` }), 3456), false)
})
test('exchanges bootstrap token for a protected cookie and removes token from navigation', () => {
  let result
  const response = { writeHead: (...args) => result = args, end() {} }
  assert.equal(auth.bootstrap({ ...request(), method: 'GET', url: `/?tauriToken=${token}` }, response, 3456), true)
  assert.equal(result[0], 200)
  assert.match(result[1]['Content-Security-Policy'], /script-src 'sha256-/)
  assert.match(result[1]['Set-Cookie'], /HttpOnly; SameSite=Strict/)
  assert.equal(auth.bootstrap({ ...request(), method: 'GET', url: '/?tauriToken=wrong' }, response, 3456), false)
})
test('requires a strong session token', () => assert.throws(() => createAuth('')))

test('the staged server uses the tested authentication implementation', async () => {
  assert.equal(await readFile('src-tauri/resources/node_modules/@lvce-editor/server/src/tauriAuth.mjs', 'utf8'), await readFile('runtime/auth.mjs', 'utf8'))
})
