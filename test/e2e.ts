import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
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
const selectedWorkspace = join(profile, 'workspace with spaces', '日本語')
const secondSelectedWorkspace = join(profile, 'second workspace')
await mkdir(workspace)
await mkdir(selectedWorkspace, { recursive: true })
await mkdir(secondSelectedWorkspace)
await mkdir('test-results', { recursive: true })
const checkpoint = (message: string) => appendFileSync('test-results/e2e-startup.log', `${new Date().toISOString()} ${message}\n`)
checkpoint(`Test runner started: ${process.execPath} (${process.pid})`)
await writeFile(join(workspace, 'smoke.txt'), 'before\n')
await writeFile(join(selectedWorkspace, 'selected.txt'), 'selected\n')
await writeFile(join(secondSelectedWorkspace, 'second.txt'), 'second\n')
const pidFile = join(profile, 'backend.pid')
const diagnosticsFile = resolve('test-results/native-startup.log')
await writeFile(diagnosticsFile, '')
checkpoint('Starting tauri-driver')
const driver = spawn('tauri-driver', [], {
  env: {
    ...process.env,
    LVCE_TAURI_DIAGNOSTICS: diagnosticsFile,
    LVCE_TAURI_WORKSPACE: workspace,
    LVCE_TAURI_PID_FILE: pidFile,
    XDG_CONFIG_HOME: join(profile, 'config'),
    XDG_DATA_HOME: join(profile, 'data'),
    XDG_CACHE_HOME: join(profile, 'cache'),
    XDG_STATE_HOME: join(profile, 'state'),
    APPDATA: join(profile, 'appdata'),
    LOCALAPPDATA: join(profile, 'localappdata'),
  },
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})
checkpoint(`Driver spawned: ${driver.pid}`)
let driverLog = ''
driver.stdout.on('data', (chunk) => {
  driverLog += chunk
})
driver.stderr.on('data', (chunk) => {
  driverLog += chunk
})
let driverError
driver.on('error', (error) => {
  driverError = error
})
let browser: Awaited<ReturnType<typeof remote>> | undefined
let backendPid: number | undefined
try {
  const deadline = Date.now() + 30000
  while (true) {
    if (driverError) throw driverError
    if (driver.exitCode !== null) throw new Error(`Driver exited: ${driverLog}`)
    try {
      if ((await fetch('http://127.0.0.1:4444/status')).ok) break
    } catch {}
    if (Date.now() >= deadline) throw new Error(`Driver startup timed out: ${driverLog}`)
    await delay(100)
  }
  const binary = process.env.TAURI_TEST_BINARY
  if (!binary) throw new Error('TAURI_TEST_BINARY must point to the packaged application')
  checkpoint('Driver ready; creating WebDriver session')
  browser = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    capabilities: { 'tauri:options': { application: resolve(binary) } } as never,
  })
  checkpoint('WebDriver session created')
  const activeBrowser = browser
  const initialWindow = (await browser.getWindowHandles())[0]
  const file = browser.$('[role="treeitem"][aria-label="smoke.txt"]')
  await file.waitForExist({ timeout: 60000 })
  await file.doubleClick()
  const input = browser.$('.EditorInput textarea')
  await input.waitForExist({ timeout: 30000 })
  // LVCE keeps its keyboard textarea offscreen; pointer events belong to visible rows.
  await browser.$('.EditorRows .EditorRow').click()
  await browser.waitUntil(() => input.isFocused(), {
    timeout: 10000,
    timeoutMsg: 'Clicking the editor did not focus its keyboard input',
  })
  await browser.keys([Key.Ctrl, 'a'])
  await browser.keys('after tauri')
  await browser.keys([Key.Ctrl, 's'])
  await browser.waitUntil(async () => (await readFile(join(workspace, 'smoke.txt'), 'utf8')).includes('after tauri'), {
    timeout: 15000,
    timeoutMsg: 'Editor did not save the edited text through its Node backend',
  })
  if (process.platform !== 'win32') {
    const isDevtoolsOpen = async (): Promise<boolean> => {
      const result = await activeBrowser.executeAsync((done: (result: unknown) => void) => {
        window.__TAURI__.core.invoke('is_devtools_open').then(done, (error: unknown) => done(String(error)))
      })
      assert.equal(typeof result, 'boolean', `Native devtools state query failed: ${result}`)
      return result as boolean
    }
    const toggleFromHelp = async () => {
      await activeBrowser.$('//*[contains(@class, "TitleBarTopLevelEntry") and normalize-space(.)="Help"]').click()
      await activeBrowser.$('//*[normalize-space(text())="Toggle Developer Tools"]').click()
    }
    assert.equal(await isDevtoolsOpen(), false)
    for (let cycle = 0; cycle < 2; cycle++) {
      await toggleFromHelp()
      await browser.waitUntil(async () => (await isDevtoolsOpen()) === true, {
        timeout: 10000,
        timeoutMsg: 'Help → Toggle Developer Tools did not open the editor webview tools',
      })
      await toggleFromHelp()
      await browser.waitUntil(async () => (await isDevtoolsOpen()) === false, {
        timeout: 10000,
        timeoutMsg: 'Help → Toggle Developer Tools did not close the editor webview tools',
      })
    }
  }
  const openFolderMenu = async () => {
    await activeBrowser.$('//*[contains(@class, "TitleBarTopLevelEntry") and normalize-space(.)="File"]').click()
    await activeBrowser.$('//*[normalize-space(text())="Open Folder"]').click()
  }
  const openNewWindow = async () => {
    const before = await browser!.getWindowHandles()
    await activeBrowser.$('//*[contains(@class, "TitleBarTopLevelEntry") and normalize-space(.)="File"]').click()
    await activeBrowser.$('//*[normalize-space(text())="New Window"]').click()
    await browser!.waitUntil(async () => (await browser!.getWindowHandles()).length === before.length + 1, {
      timeout: 15000,
      timeoutMsg: 'File → New Window did not create a native window',
    })
    return (await browser!.getWindowHandles()).find((handle: string) => !before.includes(handle))!
  }
  const closeCurrentWindow = async () => {
    const handlesBeforeClose = await browser!.getWindowHandles()
    const closingHandle = await browser!.getWindowHandle()
    const isLastWindow = handlesBeforeClose.length === 1
    try {
      const result = await browser!.executeAsync((done: (result: unknown) => void) => {
        window.__TAURI__.window
          .getCurrentWindow()
          .close()
          .then(
            () => done('closed'),
            (error: unknown) => done(`close failed: ${String(error)}`),
          )
      })
      if (process.platform !== 'win32' || result !== null) assert.equal(result, 'closed')
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/All window handles were removed|Session terminated without a reply|invalid session id/.test(error.message)
      ) {
        throw error
      }
    }
    if (!isLastWindow) {
      await browser!.waitUntil(async () => !(await browser!.getWindowHandles()).includes(closingHandle), {
        timeout: 10000,
        timeoutMsg: `Native window ${closingHandle} did not close`,
      })
    }
  }
  const assertBackendAlive = () => {
    assert.ok(backendPid)
    process.kill(backendPid, 0)
  }
  const setFolderPickerResult = async (path: string | null) => {
    await activeBrowser.execute((selectedPath: string | null) => {
      window.__TAURI__.dialog.open = async (options: unknown) => {
        ;(window as unknown as { __folderDialogOptions: unknown }).__folderDialogOptions = options
        return selectedPath
      }
    }, path)
  }
  const selectFolder = async (path: string) => {
    await setFolderPickerResult(path)
    await openFolderMenu()
  }
  await selectFolder(selectedWorkspace)
  await browser.$('[role="treeitem"][aria-label="selected.txt"]').waitForExist({ timeout: 30000 })
  const folderDialogOptions = await browser.execute(
    () =>
      (window as unknown as { __folderDialogOptions: { directory: boolean; multiple: boolean; title: string } })
        .__folderDialogOptions,
  )
  assert.deepEqual(folderDialogOptions, { directory: true, multiple: false, title: 'Open Folder' })
  await setFolderPickerResult(null)
  await openFolderMenu()
  await browser.$('[role="treeitem"][aria-label="selected.txt"]').waitForExist({ timeout: 30000 })
  await selectFolder(secondSelectedWorkspace)
  await browser.$('[role="treeitem"][aria-label="second.txt"]').waitForExist({ timeout: 30000 })
  backendPid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(backendPid > 0)
  await browser.saveScreenshot('test-results/editor.png')
  const secondWindow = await openNewWindow()
  await browser.switchToWindow(secondWindow)
  await browser.$('.EditorRows').waitForExist({ timeout: 30000 })
  const thirdWindow = await openNewWindow()
  await browser.switchToWindow(thirdWindow)
  await browser.$('.EditorRows').waitForExist({ timeout: 30000 })
  await setFolderPickerResult(selectedWorkspace)
  await openFolderMenu()
  await browser.$('[role="treeitem"][aria-label="selected.txt"]').waitForExist({ timeout: 30000 })
  const secondaryFolderDialogOptions = await browser.execute(
    () =>
      (window as unknown as { __folderDialogOptions: { directory: boolean; multiple: boolean; title: string } })
        .__folderDialogOptions,
  )
  assert.deepEqual(secondaryFolderDialogOptions, { directory: true, multiple: false, title: 'Open Folder' })
  assertBackendAlive()

  await browser.switchToWindow(secondWindow)
  await closeCurrentWindow()
  assertBackendAlive()
  await browser.switchToWindow(initialWindow)
  await browser.$('.EditorRows').waitForExist({ timeout: 15000 })

  await closeCurrentWindow()
  assertBackendAlive()
  await browser.switchToWindow(thirdWindow)
  await browser.$('.EditorRows').waitForExist({ timeout: 15000 })
  await closeCurrentWindow()
  const stopDeadline = Date.now() + 10000
  while (true) {
    try {
      process.kill(backendPid, 0)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') break
      throw error
    }
    if (Date.now() > stopDeadline) throw new Error(`Backend ${backendPid} survived window close`)
    await delay(100)
  }
  const diagnostics = await readFile(diagnosticsFile, 'utf8')
  assert.match(diagnostics, /Native window event: CloseRequested/)
  assert.match(diagnostics, /Backend retained for surviving native windows/)
  assert.match(diagnostics, /Backend stopped after native window close/)
  // Session cleanup must not be what terminates the backend under test.
  await browser.deleteSession().catch(() => {})
  browser = undefined
} catch (error) {
  await writeFile('test-results/error.txt', error instanceof Error ? error.stack || error.message : String(error))
  if (process.platform === 'win32') {
    const inventory = await promisify(execFile)('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "lvce-tauri|msedge|WebView" } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json',
    ]).catch((error) => ({ stdout: String(error) }))
    await writeFile('test-results/windows-processes.json', inventory.stdout)
  }
  if (browser) {
    const url = new URL(await browser.getUrl().catch(() => 'about:blank'))
    await writeFile('test-results/location.txt', `${url.origin}${url.pathname}`)
    await browser.saveScreenshot('test-results/failure.png').catch(() => {})
    await writeFile('test-results/page.html', await browser.getPageSource().catch(() => ''))
  }
  throw error
} finally {
  if (browser) await browser.deleteSession().catch(() => {})
  const killTree = async (pid: number | undefined) => {
    if (!pid) return
    if (process.platform === 'win32') {
      await promisify(execFile)('taskkill', ['/PID', `${pid}`, '/T', '/F']).catch(() => {})
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
      }
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
