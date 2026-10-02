import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

test('staged server authenticates HTTP and websocket access and serves the editor', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'lvce-tauri-server-'))
  const root = resolve('src-tauri/resources')
  const child = spawn(join(root, process.platform === 'win32' ? 'node.exe' : 'node'), [join(root, 'launch.mjs')], {
    cwd: root,
    env: { ...process.env, LVCE_TAURI_WORKSPACE: profile, XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_STATE_HOME: join(profile, 'state') },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timeout: ${output}`)), 30000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${output}`)) })
      child.stdout.on('data', (chunk) => {
        output += chunk
        const match = output.match(/LVCE_TAURI_READY (http:\/\/127\.0\.0\.1:\d+\/\?tauriToken=[a-f0-9]{64})/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    const origin = new URL(url).origin
    assert.equal((await fetch(origin)).status, 401)
    const bootstrap = await fetch(url, { redirect: 'manual' })
    assert.equal(bootstrap.status, 303)
    const cookie = bootstrap.headers.get('set-cookie').split(';')[0]
    const page = await fetch(origin, { headers: { cookie } })
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<html/i)
    assert.equal((await fetch(origin, { headers: { cookie, Origin: 'http://evil.example' } })).status, 401)
  } finally {
    const exited = once(child, 'exit')
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', `${child.pid}`, '/T', '/F'])
      await once(killer, 'exit')
    } else {
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    if (child.exitCode === null && child.signalCode === null) await exited
    await rm(profile, { recursive: true, force: true })
  }
})
