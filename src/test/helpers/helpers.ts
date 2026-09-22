import forge from 'node-forge'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../../core/engine'

export const CORE =
    process.env.TAPLINE_TEST_CORE ||
    join(
        __dirname,
        '..',
        '..',
        '..',
        'core',
        `${process.platform}-${process.arch}`,
        process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'
    )

export function freePort() {
    return new Promise<number>((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo
            server.close(() => resolve(port))
        })
    })
}

/** Self-signed leaf for 127.0.0.1 / localhost, RSA 2048. */
export function selfSigned() {
    const pair = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = pair.publicKey
    cert.serialNumber = '02'
    cert.validity.notBefore = new Date(Date.now() - 60000)
    cert.validity.notAfter = new Date(Date.now() + 86400000)
    const subject = [{ name: 'commonName', value: 'localhost' }]
    cert.setSubject(subject)
    cert.setIssuer(subject)
    cert.setExtensions([
        { name: 'basicConstraints', cA: true },
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' }
            ]
        }
    ])
    cert.sign(pair.privateKey, forge.md.sha256.create())
    return {
        cert: forge.pki.certificateToPem(cert),
        key: forge.pki.privateKeyToPem(pair.privateKey)
    }
}

export async function startEngine(configure?: (engine: Engine) => void) {
    const directory = mkdtempSync(join(tmpdir(), 'tapline-test-'))
    const engine = new Engine(directory, CORE)
    engine.settings.port = await freePort()
    configure?.(engine)
    await engine.start()
    return engine
}

/** Wait until the transaction matching `predicate` reaches a final state. */
export function settled(
    engine: Engine,
    predicate: (t: ReturnType<Engine['transactions']['get']> & {}) => boolean,
    timeout = 15000
) {
    return new Promise<NonNullable<ReturnType<Engine['transactions']['get']>>>(
        (resolve, reject) => {
            const check = () => {
                for (const t of engine.transactions.values())
                    if (predicate(t) && t.state !== 'pending') return resolve(t)
            }
            const listener = () => check()
            engine.on('event', listener)
            check()
            setTimeout(() => {
                engine.off('event', listener)
                reject(new Error('timed out waiting for transaction'))
            }, timeout).unref()
        }
    )
}

export function httpServer(handler: http.RequestListener) {
    return new Promise<{ server: http.Server; port: number }>((resolve) => {
        const server = http.createServer(handler)
        server.listen(0, '127.0.0.1', () =>
            resolve({ server, port: (server.address() as net.AddressInfo).port })
        )
    })
}

export function httpsServer(
    identity: { cert: string; key: string },
    handler: http.RequestListener
) {
    return new Promise<{ server: https.Server; port: number }>((resolve) => {
        const server = https.createServer(identity, handler)
        server.listen(0, '127.0.0.1', () =>
            resolve({ server, port: (server.address() as net.AddressInfo).port })
        )
    })
}

/** Plain HTTP request through the proxy (absolute-URI form). */
export function viaProxy(
    proxyPort: number,
    url: string,
    options: http.RequestOptions = {},
    body?: string
) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = http.request(
            {
                host: '127.0.0.1',
                port: proxyPort,
                path: url,
                method: options.method ?? 'GET',
                headers: { host: new URL(url).host, ...options.headers }
            },
            (response) => {
                const chunks: Buffer[] = []
                response.on('data', (c) => chunks.push(c))
                response.on('end', () =>
                    resolve({
                        status: response.statusCode!,
                        body: Buffer.concat(chunks).toString()
                    })
                )
            }
        )
        request.on('error', reject)
        request.end(body)
    })
}

/** HTTPS request through the proxy: CONNECT, then TLS trusting `ca`. */
export async function viaProxyTLS(
    proxyPort: number,
    url: string,
    ca: string,
    options: http.RequestOptions = {},
    body?: string
) {
    const target = new URL(url)
    const socket = net.connect(proxyPort, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () =>
            socket.write(
                `CONNECT ${target.hostname}:${target.port} HTTP/1.1\r\nHost: ${target.hostname}:${target.port}\r\n\r\n`
            )
        )
        socket.once('error', reject)
        let buffer = ''
        const onData = (chunk: Buffer) => {
            buffer += chunk.toString()
            if (!buffer.includes('\r\n\r\n')) return
            socket.off('data', onData)
            if (/^HTTP\/1\.[01] 200/.test(buffer)) resolve()
            else reject(new Error(buffer.split('\r\n')[0]))
        }
        socket.on('data', onData)
    })
    const secure = tls.connect({ socket, servername: target.hostname, ca: [ca] })
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = http.request(
            {
                createConnection: () => secure as unknown as net.Socket,
                host: target.hostname,
                port: target.port,
                path: target.pathname + target.search,
                method: options.method ?? 'GET',
                headers: options.headers
            },
            (response) => {
                const chunks: Buffer[] = []
                response.on('data', (c) => chunks.push(c))
                response.on('end', () => {
                    resolve({
                        status: response.statusCode!,
                        body: Buffer.concat(chunks).toString()
                    })
                    secure.destroy()
                })
            }
        )
        request.on('error', reject)
        request.end(body)
    })
}
