import { run } from './exec.js'

interface CloneOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: 'pipe' | 'inherit' | 'ignore'
}

interface SourcePin {
  repository: string
  revision: string
}

export const cloneSource = (source: SourcePin, cwd: string, options: CloneOptions = {}) => {
  // Patches and upstream build replacements require LF even on Windows.
  run('git', ['clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--filter=blob:none', source.repository, cwd], options)
  run('git', ['checkout', '--detach', source.revision], { ...options, cwd })
}
