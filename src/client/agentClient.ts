import * as vscode from 'vscode'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { pipePath } from '../agent/paths'
import type { Message, Request, Responses } from '../agent/protocol'
import {
    defaultSettings,
    type AgentState,
    type ComposeRequest,
    type Event,
    type Settings,
    type Transaction
} from '../shared/model'

type Method = Request['method']
type Args<M extends Method> = Omit<Extract<Request, { method: M }>, 'method'>

/** Bundled core for this platform, or the repository build output in development. */
export function corePath(context: vscode.ExtensionContext) {
    const binary = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'
    const packaged = join(context.extensionPath, 'core', binary)
    if (existsSync(packaged)) return packaged
    return join(context.extensionPath, 'core', `${process.platform}-${process.arch}`, binary)
}

/**
 * Client for the shared capture agent. Keeps a local mirror of the traffic so the
 * tree view and documents read synchronously; the agent is the source of truth.
 */
export class AgentClient implements vscode.Disposable {
    readonly output: vscode.LogOutputChannel
    readonly transactions = new Map<string, Transaction>()
    state: AgentState = {
        running: false,
        recording: true,
        port: 0,
        certificatePath: '',
        truststorePath: '',
        clients: 0,
        pid: 0
    }
    private socket?: net.Socket
    private ready?: Promise<void>
    private sequence = 0
    private pending = new Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >()
    private readonly events = new vscode.EventEmitter<Event>()
    readonly onEvent = this.events.event
    private disposed = false

    constructor(private context: vscode.ExtensionContext) {
        this.output = vscode.window.createOutputChannel('Tapline', { log: true })
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (change.affectsConfiguration('tapline') && this.socket)
                    void this.call('settings', { settings: this.settings() }).catch((error) =>
                        this.output.error(String(error))
                    )
            })
        )
    }

    private settings(): Settings {
        const config = vscode.workspace.getConfiguration('tapline')
        return {
            port: config.get<number>('port', defaultSettings.port),
            ssl: config.get<boolean>('ssl.enabled', defaultSettings.ssl),
            sslHosts: config.get<string[]>('ssl.hosts', defaultSettings.sslHosts),
            maxEntries: config.get<number>('maxEntries', defaultSettings.maxEntries),
            maxBodyBytes:
                config.get<number>('maxBodyKiB', defaultSettings.maxBodyBytes / 1024) * 1024
        }
    }

    get running() {
        return this.state.running
    }
    get recording() {
        return this.state.recording
    }
    get port() {
        return this.state.port
    }
    get certificatePath() {
        return this.state.certificatePath
    }
    get truststorePath() {
        return this.state.truststorePath
    }
    get connected() {
        return !!this.socket && !this.socket.destroyed
    }

    /** Connect to a running agent or spawn one; resolves once the mirror is populated. */
    connect(): Promise<void> {
        if (this.ready) return this.ready
        this.ready = this.establish().catch((error) => {
            this.ready = undefined
            throw error
        })
        return this.ready
    }

    private async establish() {
        const directory = this.context.globalStorageUri.fsPath
        const path = pipePath(directory)
        let socket = await this.dial(path).catch(() => undefined)
        if (!socket) {
            this.spawnAgent(directory)
            const deadline = Date.now() + 10000
            while (!socket) {
                await new Promise((r) => setTimeout(r, 150))
                socket = await this.dial(path).catch(() => undefined)
                if (!socket && Date.now() > deadline)
                    throw new Error(
                        vscode.l10n.t(
                            'The Tapline capture agent did not start. See the Tapline output channel.'
                        )
                    )
            }
        }
        this.attach(socket)
        this.state = await this.call('hello', { settings: this.settings() })
        await this.resync()
    }

    private dial(path: string) {
        return new Promise<net.Socket>((resolve, reject) => {
            const socket = net.connect(path)
            socket.once('connect', () => resolve(socket))
            socket.once('error', reject)
        })
    }

    private spawnAgent(directory: string) {
        const script = join(this.context.extensionPath, 'dist', 'agent.js')
        const core = corePath(this.context)
        this.output.info(`Starting capture agent: ${script} (core ${core})`)
        // The extension host is Electron; ELECTRON_RUN_AS_NODE turns the same binary
        // into a plain Node runtime for the detached agent.
        const child = spawn(process.execPath, [script, directory, core], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            windowsHide: true
        })
        createInterface({ input: child.stdout! }).on('line', (line) =>
            this.output.debug(`agent: ${line}`)
        )
        createInterface({ input: child.stderr! }).on('line', (line) =>
            this.output.warn(`agent: ${line}`)
        )
        child.on('exit', (code) => this.output.info(`Capture agent exited (${code})`))
        child.unref()
    }

    private attach(socket: net.Socket) {
        this.socket = socket
        socket.setNoDelay(true)
        createInterface({ input: socket }).on('line', (line) => {
            let message: Message
            try {
                message = JSON.parse(line)
            } catch {
                return
            }
            if ('event' in message) this.receive(message.event)
            else {
                const waiter = this.pending.get(message.id)
                if (!waiter) return
                this.pending.delete(message.id)
                if ('error' in message) waiter.reject(new Error(message.error))
                else waiter.resolve(message.result)
            }
        })
        socket.on('error', (error) => this.output.error(`agent connection: ${error.message}`))
        socket.on('close', () => {
            if (this.socket !== socket) return
            this.socket = undefined
            this.ready = undefined
            for (const waiter of this.pending.values())
                waiter.reject(
                    new Error(vscode.l10n.t('Lost connection to the Tapline capture agent'))
                )
            this.pending.clear()
            this.state = { ...this.state, running: false, clients: 0 }
            this.events.fire({ type: 'state', state: this.state })
            if (!this.disposed) setTimeout(() => void this.connect().catch(() => {}), 1000)
        })
    }

    private receive(event: Event) {
        if (event.type === 'transaction')
            this.transactions.set(event.transaction.id, event.transaction)
        else if (event.type === 'state') this.state = event.state
        else if (event.type === 'log') {
            const log = event.log
            if (log.level === 'error') this.output.error(log.message)
            else if (log.level === 'warn') this.output.warn(log.message)
            else this.output.info(log.message)
        } else if (event.type === 'reset') {
            void this.resync()
            return
        }
        this.events.fire(event)
    }

    /** `reset` means the agent's transaction set changed (clear/delete/eviction). */
    private async resync() {
        const snapshot = await this.call('snapshot', {}).catch(() => undefined)
        if (!snapshot) return
        this.transactions.clear()
        for (const t of snapshot.transactions) this.transactions.set(t.id, t)
        this.state = snapshot.state
        this.events.fire({ type: 'state', state: this.state })
    }

    async call<M extends Method>(method: M, args: Args<M>): Promise<Responses[M]> {
        if (!this.socket) await this.connect()
        const socket = this.socket!
        const id = ++this.sequence
        return new Promise<Responses[M]>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
            socket.write(JSON.stringify({ id, method, ...args }) + '\n')
        })
    }

    private async apply(promise: Promise<AgentState>) {
        this.state = await promise
        this.events.fire({ type: 'state', state: this.state })
    }
    start() {
        return this.apply(this.call('start', {}))
    }
    stop() {
        return this.apply(this.call('stop', {}))
    }
    setRecording(value: boolean) {
        return this.apply(this.call('record', { value }))
    }
    async clear() {
        await this.call('clear', {})
    }
    async delete(ids: string[]) {
        await this.call('delete', { ids })
    }
    compose(request: ComposeRequest) {
        return this.call('compose', { request })
    }

    dispose() {
        this.disposed = true
        this.socket?.destroy()
        this.events.dispose()
        this.output.dispose()
    }
}
