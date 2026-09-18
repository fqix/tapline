import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { PROTOCOL } from './protocol'

/** Unix socket path or Windows named pipe derived from the storage directory. */
export function pipePath(directory: string) {
    const hash = createHash('sha256').update(`${PROTOCOL}:${directory}`).digest('hex').slice(0, 16)
    if (process.platform === 'win32') return `\\\\.\\pipe\\tapline-${hash}`
    // Unix socket paths are limited to ~104 bytes; keep them short.
    const base = process.platform === 'darwin' ? '/tmp' : process.env.XDG_RUNTIME_DIR || '/tmp'
    return join(base, `tapline-${hash}.sock`)
}
