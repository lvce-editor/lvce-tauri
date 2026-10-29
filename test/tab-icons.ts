import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { remote } from 'webdriverio'

type Browser = Awaited<ReturnType<typeof remote>>

export const testTabIcons = async (browser: Browser): Promise<void> => {
  await browser.execute(() => {
    const samples: { title: string; offset: number; icon: boolean; width: number; loaded: boolean; frame: boolean }[] = []
    const presentations: { title: string; milliseconds: number }[] = []
    let frame = 0
    const sample = (frame = false) => {
      const tab = document.querySelector('.MainTabSelected')
      const title = tab?.querySelector('.TabTitle')
      if (!(tab instanceof HTMLElement) || !(title instanceof HTMLElement) || !/^[ab]\.py$/.test(title.textContent || '')) return
      const icon = tab.querySelector('img.TabIcon')
      const record = {
        title: title.textContent!,
        offset: title.getBoundingClientRect().left - tab.getBoundingClientRect().left,
        icon: icon instanceof HTMLImageElement && Boolean(icon.getAttribute('src')),
        width: icon?.getBoundingClientRect().width || 0,
        loaded: icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0,
        frame,
      }
      if (samples.length < 2000) samples.push(record)
    }
    const tick = () => {
      sample(true)
      frame = requestAnimationFrame(tick)
    }
    const observer = new MutationObserver(() => sample())
    observer.observe(document.body, { attributes: true, childList: true, subtree: true })
    frame = requestAnimationFrame(tick)
    ;(window as unknown as { __tabIconEvidence: unknown }).__tabIconEvidence = {
      samples,
      presentations,
      recordPresentation: (title: string, milliseconds: number) => presentations.push({ title, milliseconds }),
      stop: () => {
        observer.disconnect()
        cancelAnimationFrame(frame)
      },
    }
  })
  try {
    const waitForTab = async (title: string) => {
      await browser.$(`.MainTabSelected[title$="/${title}"] img.TabIcon[src]`).waitForDisplayed({ timeout: 15000 })
      await browser.waitUntil(
        () =>
          browser.execute((name: string) => {
            const icon = document.querySelector(`.MainTabSelected[title$="/${name}"] img.TabIcon`)
            return icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0
          }, title),
        { timeout: 15000, timeoutMsg: `${title} icon did not load` },
      )
      await browser.$('.EditorRows').waitForDisplayed({ timeout: 15000 })
    }
    const clickAndWait = async (title: string, selector: string, doubleClick = false) => {
      const start = await browser.execute(() => performance.now())
      if (doubleClick) await browser.$(selector).doubleClick()
      else await browser.$(selector).click()
      await waitForTab(title)
      const milliseconds = await browser.execute((started: number) => performance.now() - started, start)
      await browser.execute(
        (name: string, elapsed: number) => {
          ;(
            window as unknown as { __tabIconEvidence: { recordPresentation: (title: string, milliseconds: number) => void } }
          ).__tabIconEvidence.recordPresentation(name, elapsed)
        },
        title,
        milliseconds,
      )
    }
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const title of ['a.py', 'b.py']) {
        await clickAndWait(title, `[role="treeitem"][aria-label="${title}"]`)
      }
    }
    for (const title of ['a.py', 'b.py']) {
      await clickAndWait(title, `[role="treeitem"][aria-label="${title}"]`, true)
    }
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const title of ['a.py', 'b.py']) {
        await clickAndWait(title, `.MainTab[title$="/${title}"]`)
      }
    }
    await browser.saveScreenshot('test-results/tab-icons.png')
  } finally {
    const evidence = await browser.execute(() => {
      const state = (
        window as unknown as {
          __tabIconEvidence: {
            samples: { title: string; offset: number; icon: boolean; width: number; loaded: boolean; frame: boolean }[]
            presentations: { title: string; milliseconds: number }[]
            stop: () => void
          }
        }
      ).__tabIconEvidence
      state.stop()
      const resources = performance
        .getEntriesByType('resource')
        .filter((entry) => /file_type_python/.test(entry.name))
        .map((entry) => ({ name: entry.name, milliseconds: entry.duration }))
      Reflect.deleteProperty(window, '__tabIconEvidence')
      return { samples: state.samples, presentations: state.presentations, resources }
    })
    await writeFile('test-results/tab-icons.json', JSON.stringify(evidence, null, 2) + '\n')
    assert.ok(evidence.samples.length > 0, 'No Python tab frames were observed')
    assert.ok(evidence.presentations.length >= 8, 'Missing tab presentation timing evidence')
    const offset = evidence.samples[0].offset
    for (const sample of evidence.samples) {
      assert.equal(sample.icon, true, `${sample.title} appeared without its icon source`)
      if (sample.frame) assert.equal(sample.loaded, true, `${sample.title} painted with an unloaded icon`)
      assert.equal(sample.width, 16, `${sample.title} lost its icon slot`)
      assert.ok(Math.abs(sample.offset - offset) < 0.5, `${sample.title} shifted horizontally`)
    }
  }
}
