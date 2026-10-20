import { createHash } from 'node:crypto'
// This file is copied into the pinned server by the maintained source patch.
interface AuthRequest {
  headers: { host?: string; origin?: string; cookie?: string }
  method?: string
  url?: string
}

interface AuthResponse {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
}

export const allowTauriIpc = (headers: Record<string, string>) => {
  const policy = headers['Content-Security-Policy']
  if (!policy) return headers
  const directives = policy.split(';').map((directive) => directive.trim())
  const connectIndex = directives.findIndex((directive) => directive.startsWith('connect-src '))
  if (connectIndex === -1) directives.push('connect-src ipc:')
  else if (!directives[connectIndex].split(/\s+/).includes('ipc:')) directives[connectIndex] += ' ipc:'
  headers['Content-Security-Policy'] = directives.join('; ')
  return headers
}

export const createAuth = (token: string | undefined) => {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Missing Tauri session token')
  const cookieName = `lvce-tauri-${token.slice(0, 16)}`
  const cookie = `${cookieName}=${token}`
  const authorize = (request: AuthRequest, port: number) => {
    const host = `127.0.0.1:${port}`
    if (request.headers.host !== host) return false
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return false
    return (request.headers.cookie || '').split(';').some((part) => part.trim() === cookie)
  }
  const bootstrap = (request: AuthRequest, response: AuthResponse, port: number) => {
    const host = `127.0.0.1:${port}`
    if (request.method !== 'GET' || request.headers.host !== host) return false
    const url = new URL(request.url || '/', `http://${host}`)
    if (url.pathname !== '/' || url.searchParams.get('tauriToken') !== token) return false
    const script = "location.replace('/')"
    const hash = createHash('sha256').update(script).digest('base64')
    response.writeHead(200, {
      'Set-Cookie': `${cookie}; HttpOnly; SameSite=Strict; Path=/`,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; frame-ancestors 'none'`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    })
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>Opening LVCE Editor</title></head><body><script>${script}</script></body></html>`,
    )
    return true
  }
  return { authorize, bootstrap }
}
