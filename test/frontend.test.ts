import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('frontend loads the emitted TypeScript bootstrap as a module', async () => {
  const index = await readFile('frontend/index.html', 'utf8')
  assert.match(index, /<script type="module" src="start\.js"><\/script>/)
})
