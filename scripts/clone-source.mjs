import { run } from './exec.mjs'

export const cloneSource = (source, cwd, options = {}) => {
  // Patches and upstream build replacements require LF even on Windows.
  run('git', ['clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--filter=blob:none', source.repository, cwd], options)
  run('git', ['checkout', '--detach', source.revision], { ...options, cwd })
}
