import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { remote, Key } from 'webdriverio'

const profile = await mkdtemp(join(tmpdir(), 'lvce-tauri-e2e-'))
const workspace = join(profile, 'workspace')
await mkdir(workspace)
await mkdir('test-results', { recursive: true })
await writeFile(join(workspace, 'smoke.txt'), 'before\n')
const pidFile = join(profile, 'backend.pid')
const driver = spawn('tauri-driver', [], {
  env: {
    ...process.env, LVCE_TAURI_DIAGNOSTICS: resolve('test-results/native-startup.log'), LVCE_TAURI_WORKSPACE: workspace, LVCE_TAURI_PID_FILE: pidFile,
    XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'),
    XDG_CACHE_HOME: join(profile, 'cache'), XDG_STATE_HOME: join(profile, 'state'),
    APPDATA: join(profile, 'appdata'), LOCALAPPDATA: join(profile, 'localappdata'),
  }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
})
let driverLog = ''
driver.stdout.on('data', (chunk) => { driverLog += chunk })
driver.stderr.on('data', (chunk) => { driverLog += chunk })
let driverError
driver.on('error', (error) => { driverError = error })
let browser
let backendPid
try {
  const deadline = Date.now() + 30000
  while (true) {
    if (driverError) throw driverError
    if (driver.exitCode !== null) throw new Error(`Driver exited: ${driverLog}`)
    try { if ((await fetch('http://127.0.0.1:4444/status')).ok) break } catch {}
    if (Date.now() >= deadline) throw new Error(`Driver startup timed out: ${driverLog}`)
    await delay(100)
  }
  browser = await remote({
    hostname: '127.0.0.1', port: 4444, logLevel: 'warn',
    capabilities: { 'tauri:options': { application: resolve(process.env.TAURI_TEST_BINARY) } },
  })
  const file = browser.$('[role="treeitem"][aria-label="smoke.txt"]')
  await file.waitForExist({ timeout: 60000 })
  await file.doubleClick()
  const input = browser.$('.EditorInput textarea')
  await input.waitForExist({ timeout: 30000 })
  // LVCE keeps its keyboard textarea offscreen; pointer events belong to visible rows.
  await browser.$('.EditorRows .EditorRow').click()
  await browser.waitUntil(() => input.isFocused(), {
    timeout: 10000, timeoutMsg: 'Clicking the editor did not focus its keyboard input',
  })
  await browser.keys([Key.Ctrl, 'a'])
  await browser.keys('after tauri')
  await browser.keys([Key.Ctrl, 's'])
  await browser.waitUntil(async () => (await readFile(join(workspace, 'smoke.txt'), 'utf8')).includes('after tauri'), {
    timeout: 15000, timeoutMsg: 'Editor did not save the edited text through its Node backend',
  })
  backendPid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(backendPid > 0)
  await browser.saveScreenshot('test-results/editor.png')
  await browser.closeWindow()
  await browser.deleteSession().catch(() => {})
  browser = undefined
  const stopDeadline = Date.now() + 10000
  while (true) {
    try { process.kill(backendPid, 0) } catch (error) { if (error.code === 'ESRCH') break; throw error }
    if (Date.now() > stopDeadline) throw new Error(`Backend ${backendPid} survived window close`)
    await delay(100)
  }
} catch (error) {
  await writeFile('test-results/error.txt', error.stack || String(error))
  if (process.platform === 'win32') {
    const inventory = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "lvce-tauri|msedge|WebView" } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json']).catch((error) => ({ stdout: String(error) }))
    await writeFile('test-results/windows-processes.json', inventory.stdout)
  }
  if (browser) {
    const url = new URL(await browser.getUrl().catch(() => 'about:blank'))
    await writeFile('test-results/location.txt', `${url.origin}${url.pathname}`)
    await browser.saveScreenshot('test-results/failure.png').catch(() => {})
    await writeFile('test-results/page.html', await browser.getPageSource().catch(() => '') )
  }
  throw error
} finally {
  if (browser) await browser.deleteSession().catch(() => {})
  const killTree = async (pid) => {
    if (!pid) return
    if (process.platform === 'win32') {
      await promisify(execFile)('taskkill', ['/PID', `${pid}`, '/T', '/F']).catch(() => {})
    } else {
      try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
  }
  // WebDriver may forcibly terminate the native host when deleting a failed session.
  // Always clean up both owned groups; the success path above still asserts normal exit.
  const savedPid = await readFile(pidFile, 'utf8').catch(() => '')
  if (savedPid) await killTree(Number(savedPid))
  if (!driverError) {
    const closed = driver.exitCode === null ? once(driver, 'close') : undefined
    await killTree(driver.pid)
    if (closed) await closed
  }
  await writeFile('test-results/driver.log', driverLog)
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
