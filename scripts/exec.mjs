import { spawnSync } from 'node:child_process'
export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
  return result.stdout?.toString().trim()
}
export const npm = (args, options) => run(process.execPath, [process.env.npm_execpath, ...args], options)
