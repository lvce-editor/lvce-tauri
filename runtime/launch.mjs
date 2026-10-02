// Rust owns this process group. All backend subprocesses inherit that group.
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
process.env.HOST = '127.0.0.1'
process.env.PORT = '0'
if (!process.env.LVCE_TAURI_WORKSPACE) throw new Error('Missing workspace directory')
process.env.FOLDER = process.env.LVCE_TAURI_WORKSPACE
process.env.LVCE_TAURI_TOKEN = randomBytes(32).toString('hex')
process.argv = [process.execPath, join(root, 'node_modules/@lvce-editor/server/bin/server.js'), process.env.LVCE_TAURI_WORKSPACE]
await import(pathToFileURL(process.argv[1]))
