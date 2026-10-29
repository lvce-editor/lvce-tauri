import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { remote } from 'webdriverio'

type Browser = Awaited<ReturnType<typeof remote>>
type Tab = { id: number; editorUid: number; loadingState: string; uri: string }
type MainState = { uid: number; layout: { groups: { activeTabId: number; tabs: Tab[] }[] } }

export const testPaintHold = async (browser: Browser): Promise<void> => {
  const execute = async <T>(command: string, ...args: unknown[]): Promise<T> => {
    const result = await browser.executeAsync(
      async (command: string, args: unknown[], done: (result: { value?: unknown; error?: string }) => void) => {
        try {
          const script = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"]')).find((node) =>
            node.src.includes('rendererProcessMain'),
          )!
          const renderer = await import(script.src)
          await renderer.ready
          done({ value: await renderer.executeCommand(command, ...args) })
        } catch (error) {
          done({ error: String(error) })
        }
      },
      command,
      args,
    )
    assert.equal(result.error, undefined)
    return result.value as T
  }
  await browser.$('.MainTab[title$="/a.py"]').click()
  const states = await execute<Record<string, { moduleId: string; uid: number }>>('Viewlet.getAllStates')
  const main = Object.values(states).find((state) => state.moduleId === 'Main')!
  const baseline = await execute<MainState>('ComponentState.getState', main.uid)
  const incoming = baseline.layout.groups[0].tabs.find((tab) => tab.uri.endsWith('/b.py'))!
  assert.notEqual(incoming.editorUid, -1)
  const pending = structuredClone(baseline)
  pending.layout.groups[0].activeTabId = incoming.id
  pending.layout.groups[0].tabs.find((tab) => tab.id === incoming.id)!.loadingState = 'loading'
  await browser.execute(() => {
    const container = document.querySelector('.Main .EditorContainer') as HTMLElement
    const original = container.querySelector('.Editor')
    const samples: { time: number; original: boolean; inert: boolean; loading: boolean }[] = []
    const sample = () =>
      samples.push({
        time: performance.now(),
        original: container.querySelector('.Editor') === original,
        inert: container.inert,
        loading: Boolean(container.querySelector('.TextEditor--loading')),
      })
    const observer = new MutationObserver(sample)
    observer.observe(container, { attributes: true, childList: true, subtree: true })
    ;(window as unknown as { __paintHold: unknown }).__paintHold = { samples, stop: () => observer.disconnect() }
    sample()
  })
  try {
    await execute('ComponentState.setState', main.uid, pending)
    await browser.$('.Main .TextEditor--loading .EditorLoadingIcon').waitForDisplayed({ timeout: 15000 })
    assert.equal(
      await browser
        .$('.Main .EditorLoadingIcon')
        .getCSSProperty('animation-name')
        .then((value) => value.value?.toLowerCase() ?? ''),
      'editorloadingspin',
    )
    await browser.saveScreenshot('test-results/paint-hold-loading.png')
    const ready = structuredClone(pending)
    ready.layout.groups[0].tabs.find((tab) => tab.id === incoming.id)!.loadingState = 'loaded'
    await execute('ComponentState.setState', main.uid, ready)
    await browser.$('.Main .EditorRows').waitForDisplayed({ timeout: 15000 })
    assert.equal(await browser.$('.Main .EditorContainer').getAttribute('inert'), null)
  } finally {
    const samples = await browser.execute(() => {
      const evidence = (
        window as unknown as {
          __paintHold: { samples: { time: number; original: boolean; inert: boolean; loading: boolean }[]; stop: () => void }
        }
      ).__paintHold
      evidence.stop()
      Reflect.deleteProperty(window, '__paintHold')
      return evidence.samples
    })
    await writeFile('test-results/paint-hold.json', JSON.stringify(samples, null, 2) + '\n')
    const held = samples.find((sample) => sample.original && sample.inert)
    const loading = samples.find((sample) => sample.loading)
    assert.ok(held, 'Outgoing editor was not held inert')
    assert.ok(loading, 'Loading fallback was not observed')
    assert.ok(loading.time - held.time >= 50, 'Outgoing editor disappeared before the holding interval')
  }
}
