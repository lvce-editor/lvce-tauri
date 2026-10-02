import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { run, npm } from './exec.js'
import { cloneSource } from './clone-source.js'
const source = JSON.parse((await readFile('lvce-source.json')).toString())
const cwd = resolve('vendor/lvce-editor')
if (!existsSync(cwd)) {
  cloneSource(source, cwd)
}
const head = run('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' })
if (head !== source.revision) throw new Error(`Expected LVCE ${source.revision}, got ${head}; preserve or remove vendor checkout before preparing again`)
for (const file of (await readdir('patches')).filter((name) => name.endsWith('.patch')).sort()) {
  const patch = resolve('patches', file)
  // Applying twice is an error: do not conceal local edits or a partially applied patch set.
  run('git', ['apply', '--check', patch], { cwd })
  run('git', ['apply', patch], { cwd })
}
npm(['ci'], { cwd, env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } })
