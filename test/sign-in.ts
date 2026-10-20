import assert from 'node:assert/strict'
import { Key, remote } from 'webdriverio'

type Browser = Awaited<ReturnType<typeof remote>>

interface SignInWindow extends Window {
  __signInTest?: {
    invoke: Window['__TAURI__']['core']['invoke']
    urls: string[]
    fail: boolean
  }
}

export const testSignIn = async (browser: Browser): Promise<void> => {
  const editorUrl = await browser.getUrl()
  // Exercise native URL validation through the packaged command and capability.
  const rejected = await browser.executeAsync((done: (value: boolean) => void) => {
    window.__TAURI__.core.invoke('open_external', { url: 'file:///etc/passwd' }).then(
      () => done(false),
      () => done(true),
    )
  })
  assert.equal(rejected, true)
  await browser.execute(() => {
    const page = window as SignInWindow
    const invoke = page.__TAURI__.core.invoke.bind(page.__TAURI__.core)
    page.__signInTest = { invoke, urls: [], fail: true }
    page.__TAURI__.core.invoke = async (command, args) => {
      if (command !== 'open_external') return invoke(command, args)
      page.__signInTest!.urls.push(String(args?.url))
      if (page.__signInTest!.fail) throw new Error('Test default browser unavailable')
      // Capture the launch instead of opening a real browser on CI.
      return undefined
    }
  })
  const signIn = async () => {
    await browser.keys([Key.Ctrl, Key.Shift, 'p'])
    const input = browser.$('input[name="QuickPickInput"]')
    await input.waitForExist({ timeout: 10000 })
    await input.setValue('>Account: Sign In')
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
      page.__TAURI__.core.invoke = page.__signInTest!.invoke
      delete page.__signInTest
    })
  }
}
