import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('launcher forwards selected workspace through the server environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvce-tauri-launch-'))
  try {
    const bin = join(root, 'node_modules/@lvce-editor/server/bin')
    await mkdir(bin, { recursive: true })
    await cp('.tmp/tsc/runtime/launch.js', join(root, 'launch.js'))
    await writeFile(join(bin, 'server.js'), 'console.log(JSON.stringify({folder:process.env.FOLDER,argv:process.argv.slice(2)}))')
    const workspace = join(root, 'selected workspace')
    const result = spawnSync(process.execPath, [join(root, 'launch.js')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FOLDER: 'wrong inherited folder', LVCE_TAURI_WORKSPACE: workspace },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { folder: workspace, argv: [workspace] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
