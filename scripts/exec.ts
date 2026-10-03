import { spawnSync } from 'node:child_process'
interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: 'pipe' | 'inherit' | 'ignore'
}

export const run = (command: string, args: string[], options: RunOptions = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
  return result.stdout?.toString().trim()
}
export const npm = (args: string[], options: RunOptions = {}) => {
  const npmExecPath = process.env.npm_execpath
  if (!npmExecPath) throw new Error('npm_execpath is not set; invoke this through npm')
  return run(process.execPath, [npmExecPath, ...args], options)
}
