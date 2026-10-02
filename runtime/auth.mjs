// This file is copied into the pinned server by the maintained source patch.
export const createAuth = (token) => {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Missing Tauri session token')
  const cookieName = `lvce-tauri-${token.slice(0, 16)}`
  const cookie = `${cookieName}=${token}`
  const authorize = (request, port) => {
    const host = `127.0.0.1:${port}`
    if (request.headers.host !== host) return false
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return false
    return (request.headers.cookie || '').split(';').some((part) => part.trim() === cookie)
  }
  const bootstrap = (request, response, port) => {
    const host = `127.0.0.1:${port}`
    if (request.method !== 'GET' || request.headers.host !== host) return false
    const url = new URL(request.url, `http://${host}`)
    if (url.pathname !== '/' || url.searchParams.get('tauriToken') !== token) return false
    response.writeHead(303, {
      'Set-Cookie': `${cookie}; HttpOnly; SameSite=Strict; Path=/`,
      'Location': '/',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    })
    response.end()
    return true
  }
  return { authorize, bootstrap }
}
