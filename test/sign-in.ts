import assert from 'node:assert/strict'
import { Key, remote } from 'webdriverio'

type Browser = Awaited<ReturnType<typeof remote>>

interface SignInWindow extends Window {
  __signInTest?: {
    tauri: Window['__TAURI__']
    urls: string[]
    fail: boolean
  }
}

export const testSignIn = async (browser: Browser): Promise<void> => {
  const editorUrl = await browser.getUrl()
  // Exercise native URL validation through the packaged command and capability.
  const rejected = await browser.executeAsync((done: (value: string) => void) => {
    window.__TAURI__.core.invoke('open_external', { url: 'file:///etc/passwd' }).then(
      () => done('Unexpected browser launch'),
      (error: unknown) => done(String(error)),
    )
  })
  assert.match(rejected as string, /External browser URLs must use HTTP or HTTPS/)
  const hook = await browser.execute(() => {
    const page = window as SignInWindow
    const tauri = page.__TAURI__
    page.__signInTest = { tauri, urls: [], fail: true }
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'open_external') return tauri.core.invoke(command, args)
      page.__signInTest!.urls.push(String(args?.url))
      if (page.__signInTest!.fail) throw new Error('Test default browser unavailable')
      return undefined
    }
    // Tauri exports frozen module namespaces. Replace the page facade, not core.invoke.
    page.__TAURI__ = { ...tauri, core: { ...tauri.core, invoke } }
    return page.__TAURI__.core.invoke === invoke
  })
  assert.equal(hook, true, 'Native browser capture hook was not installed')
  const signIn = async () => {
    await browser.$('.EditorRows .EditorRow').click()
    await browser.waitUntil(() => browser.$('.EditorInput textarea').isFocused(), { timeout: 10000 })
    await browser.keys([Key.Ctrl, Key.Shift, 'p'])
    const input = browser.$('input[name="QuickPickInput"]')
    await input.waitForExist({ timeout: 10000 })
    await browser.waitUntil(() => browser.$('input[name="QuickPickInput"]').isFocused(), { timeout: 10000 })
    // Clearing the command prefix changes providers and can replace the input in WebKit.
    await browser.keys('Account: Sign In')
    const command = browser.$('.QuickPickItem')
    await browser.waitUntil(async () => (await command.getText()).includes('Account: Sign In'), { timeout: 10000 })
    await browser.keys(Key.Enter)
  }
  const urls = () => browser.execute(() => [...(window as SignInWindow).__signInTest!.urls])
  try {
    await signIn()
    await browser.waitUntil(async () => (await urls()).length === 1, { timeout: 15000 })
    await browser.$('//*[contains(text(), "Test default browser unavailable")]').waitForExist({ timeout: 10000 })
    const authorizationUrl = new URL((await urls())[0])
    assert.equal(authorizationUrl.searchParams.get('client_id'), 'lvce-editor-native')
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256')
    const redirect = new URL(authorizationUrl.searchParams.get('redirect_uri')!)
    assert.equal(redirect.protocol, 'http:')
    assert.equal(redirect.hostname, 'localhost')
    assert.equal(redirect.pathname, '/callback')
    assert.ok(redirect.port)
    await assert.rejects(fetch(redirect.href))
    assert.equal(await browser.getUrl(), editorUrl)
    await browser.$('.Workbench').waitForExist()
    // A second attempt succeeds at launch, then simulates the user closing the browser.
    await browser.execute(() => {
      ;(window as SignInWindow).__signInTest!.fail = false
    })
    await signIn()
    await browser.waitUntil(async () => (await urls()).length === 2, { timeout: 15000 })
    const second = new URL((await urls())[1])
    const callback = second.searchParams.get('redirect_uri')!
    assert.notEqual(second.searchParams.get('state'), authorizationUrl.searchParams.get('state'))
    assert.equal((await fetch(callback)).status, 200)
    await browser.$('//*[contains(text(), "Timed out waiting for backend login.")]').waitForExist({ timeout: 45000 })
    await assert.rejects(fetch(callback))
    assert.equal((await urls()).length, 2)
    assert.equal(await browser.getUrl(), editorUrl)
    await browser.$('.Workbench').waitForExist()
  } finally {
    await browser.execute(() => {
      const page = window as SignInWindow
      page.__TAURI__ = page.__signInTest!.tauri
      delete page.__signInTest
    })
  }
}
