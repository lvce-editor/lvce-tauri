import { access, chmod, cp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { npm } from './exec.mjs'
const source = JSON.parse(await readFile('lvce-source.json'))
if (process.versions.node !== source.node) throw new Error(`Use Node ${source.node}; the build bundles this exact executable`)
const base = resolve('vendor/lvce-editor')
const out = resolve('src-tauri/resources')
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
npm(['run', 'build:server'], { cwd: base, env: { ...process.env, GIT_TAG: 'v0.1.0' } })
const names = ['server', 'shared-process', 'static-server']
for (const name of names) {
  await cp(join(base, 'packages/build/.tmp/server', name), join(out, 'node_modules/@lvce-editor', name), { recursive: true, dereference: true })
}
// Copy the dependency graph installed by upstream's lockfile, preserving its hoisting.
// Never run another dependency resolution against floating ranges during packaging.
const seen = new Set()
const locate = async (from, name) => {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    try { await access(join(candidate, 'package.json')); return await realpath(candidate) } catch {}
    if (dirname(dir) === dir) throw new Error(`Missing dependency ${name} from ${from}`)
  }
}
const collect = async (dir, built = false) => {
  if (seen.has(dir)) return
  seen.add(dir)
  if (!built) {
    const rel = relative(base, dir)
    if (rel.startsWith('..')) throw new Error(`Dependency outside checkout: ${dir}`)
    const parts = rel.split(sep)
    const target = parts[0] === 'packages'
      ? join(out, 'node_modules/@lvce-editor', parts[1], ...parts.slice(2))
      : join(out, rel)
    await cp(dir, target, { recursive: true, dereference: true, filter: (file) => file === dir || basename(file) !== 'node_modules' })
  }
  const pkg = JSON.parse(await readFile(join(dir, 'package.json')))
  const optional = pkg.optionalDependencies || {}
  for (const name of new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(optional), ...Object.keys(pkg.peerDependencies || {})])) {
    let dependency
    try { dependency = await locate(dir, name) } catch (error) {
      if (name in optional || pkg.peerDependenciesMeta?.[name]?.optional) continue
      throw error
    }
    await collect(dependency, names.some((item) => dependency === join(base, 'packages', item)))
  }
}
for (const name of names) await collect(join(base, 'packages', name), true)
await cp(process.execPath, join(out, process.platform === 'win32' ? 'node.exe' : 'node'))
await chmod(join(out, process.platform === 'win32' ? 'node.exe' : 'node'), 0o755)
await cp('runtime', out, { recursive: true })
await cp(join(base, 'LICENSE'), join(out, 'LVCE-LICENSE'))
// Node's license includes notices for the libraries statically linked into its executable.
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${source.node}/LICENSE`)
if (!license.ok) throw new Error(`Node license download failed: ${license.status}`)
await import('node:fs/promises').then(({ writeFile }) => writeFile(join(out, 'NODE-LICENSE'), license.body))
