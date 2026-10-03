import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { cloneSource } from '../scripts/clone-source.js'
import { run } from '../scripts/exec.js'

test('clone and patch work with inherited Windows CRLF settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvce-tauri-clone-'))
  try {
    const repository = join(root, 'source')
    const target = join(root, 'target')
    await mkdir(repository)
    run('git', ['init', repository], { stdio: 'pipe' })
    const options = { cwd: repository, stdio: 'pipe' as const }
    const content = 'first line\nsecond line\n'
    await writeFile(join(repository, 'file.txt'), content)
    run('git', ['-c', 'core.autocrlf=false', 'add', '.'], options)
    run(
      'git',
      ['-c', 'user.name=levivilet', '-c', 'user.email=72156503+levivilet@users.noreply.github.com', 'commit', '-m', 'fixture'],
      options,
    )
    const revision = run('git', ['rev-parse', 'HEAD'], options)
    const config = join(root, 'gitconfig')
    await writeFile(config, '[core]\n autocrlf = true\n eol = crlf\n')
    const env = { ...process.env, GIT_CONFIG_GLOBAL: config }
    cloneSource({ repository, revision }, target, { env, stdio: 'pipe' })
    assert.equal(await readFile(join(target, 'file.txt'), 'utf8'), content)
    const patch = join(root, 'change.patch')
    await writeFile(
      patch,
      'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n first line\n-second line\n+patched line\n',
    )
    run('git', ['apply', '--check', patch], { cwd: target, env, stdio: 'pipe' })
    run('git', ['apply', patch], { cwd: target, env, stdio: 'pipe' })
    assert.equal(await readFile(join(target, 'file.txt'), 'utf8'), 'first line\npatched line\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('checked-in patch stays LF and applies to the pinned upstream source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvce-tauri-patch-'))
  try {
    const directory = join(root, 'packages/server/src')
    await mkdir(directory, { recursive: true })
    run('git', ['init', root], { stdio: 'pipe' })
    const original =
      run('git', ['show', 'HEAD:packages/server/src/server.js'], { cwd: resolve('vendor/lvce-editor'), stdio: 'pipe' }) + '\n'
    await writeFile(join(directory, 'server.js'), original)
    const patch = resolve('patches/0001-tauri-server.patch')
    const content = await readFile(patch, 'utf8')
    assert.equal(content.includes('\r'), false, 'Git must check out patch files with LF on every OS')
    const crlfPatch = join(root, 'crlf.patch')
    await writeFile(crlfPatch, content.replaceAll('\n', '\r\n'))
    assert.throws(() => run('git', ['apply', '--check', crlfPatch], { cwd: root, stdio: 'pipe' }))
    run('git', ['apply', '--check', patch], { cwd: root, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Tauri product name patch applies to the pinned upstream build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvce-tauri-product-name-patch-'))
  try {
    const sourcePath = 'packages/build/src/parts/BuildStaticServer/BuildStaticServer.ts'
    const source = join(root, sourcePath)
    await mkdir(join(root, 'packages/build/src/parts/BuildStaticServer'), { recursive: true })
    run('git', ['init', root], { stdio: 'pipe' })
    const original = run('git', ['show', `HEAD:${sourcePath}`], { cwd: resolve('vendor/lvce-editor'), stdio: 'pipe' }) + '\n'
    await writeFile(source, original)
    const patch = resolve('patches/0002-tauri-product-name.patch')
    const content = await readFile(patch, 'utf8')
    assert.equal(content.includes('\r'), false, 'Git must check out patch files with LF on every OS')
    run('git', ['apply', '--check', patch], { cwd: root, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native folder picker patch applies to the pinned upstream renderer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvce-tauri-folder-picker-patch-'))
  try {
    const sourcePath = 'packages/renderer-worker/src/parts/OpenFolderRemote/OpenFolderRemote.js'
    const target = join(root, sourcePath)
    await mkdir(join(root, 'packages/renderer-worker/src/parts/OpenFolderRemote'), { recursive: true })
    run('git', ['init', root], { stdio: 'pipe' })
    const source = run('git', ['show', `HEAD:${sourcePath}`], { cwd: resolve('vendor/lvce-editor'), stdio: 'pipe' }) + '\n'
    await writeFile(target, source)
    const patch = resolve('patches/0004-native-open-folder-picker.patch')
    const content = await readFile(patch, 'utf8')
    assert.equal(content.includes('\r'), false, 'Git must check out patch files with LF on every OS')
    run('git', ['apply', '--check', patch], { cwd: root, stdio: 'pipe' })
    run('git', ['apply', patch], { cwd: root, stdio: 'pipe' })
    const patched = await readFile(target, 'utf8')
    assert.match(patched, /BroadcastChannel\('lvce-tauri-folder-picker'\)/)
    assert.match(patched, /Prompt\.prompt\('Choose Path:', '\/home'\)/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
