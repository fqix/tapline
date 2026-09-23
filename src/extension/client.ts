import { preferences } from './preferences'
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, statSync } from 'node:fs'
import net from 'node:net'
import { isAbsolute, join } from 'node:path'
import { pipePath } from '../agent/paths'
import type { Message, Request, Responses } from '../agent/protocol'
import {
    defaultSettings,
    type AgentState,
    type BreakpointEdit,
    type ComposeRequest,
    type Event,
    type Rule,
    type Settings,
    type Transaction
} from '../shared/model'

type Method = Request['method']
type Args<M extends Method> = Omit<Extract<Request, { method: M }>, 'method'>

/** Release versions take precedence over file timestamps, which vary by installation. */
export function needsAgentUpgrade(version: string | undefined, state: AgentState, build?: number) {
    const local = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
    if (!local) return false
    if (!state.agentVersion) return build !== undefined && state.build !== build
    const remote = state.agentVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
    if (!remote) return false
    for (let i = 1; i <= 3; i++) {
        const difference = Number(local[i]) - Number(remote[i])
        if (difference) return difference > 0
    }
    return false
}

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
    /** Every window is its own capture session on the shared agent. */
    private readonly session = vscode.env.sessionId || randomUUID()
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
    private upgrading = false
    private retiringSocket?: net.Socket
    /** Absolute .proto paths found in the workspace; pushed to the agent with the settings. */
    protoFiles: string[] = []

    constructor(private context: vscode.ExtensionContext) {
        this.output = vscode.window.createOutputChannel('Tapline', { log: true })
        context.subscriptions.push(
            preferences.onDidChange((change) => {
                if (change.affectsConfiguration('tapline') && this.socket)
                    void this.call('settings', { settings: this.settings() }).catch((error) =>
                        this.output.error(String(error))
                    )
            })
        )
    }

    /** Resend the settings, e.g. after the .proto file set changed. */
    pushSettings() {
        if (!this.socket) return Promise.resolve()
        return this.call('settings', { settings: this.settings() }).then(
            () => undefined,
            (error) => this.output.error(String(error))
        )
    }

    private settings(): Settings {
        const config = preferences
        return {
            port: config.get<number>('port', defaultSettings.port),
            sslHosts: config.get<string[]>('ssl.hosts', defaultSettings.sslHosts),
            sslNoHosts: config.get<string[]>('ssl.noHosts', defaultSettings.sslNoHosts),
            insecureUpstream: config.get<boolean>(
                'ssl.insecureUpstream',
                defaultSettings.insecureUpstream
            ),
            maxEntries: config.get<number>('maxEntries', defaultSettings.maxEntries),
            maxBodyBytes:
                config.get<number>('maxBodyKiB', defaultSettings.maxBodyBytes / 1024) * 1024,
            mcpPort: config.get<boolean>('mcp.enabled', true)
                ? config.get<number>('mcp.port', defaultSettings.mcpPort)
                : 0,
            protoFiles: this.protoFiles,
            rules: this.rules(true)
        }
    }

    /**
     * Rules from `tapline.rules`, normalised (ids, `enabled`). With `resolve`, map-local
     * files are made absolute against the workspace for the agent; the editor gets them
     * as written so relative paths survive a round trip.
     */
    rules(resolve = false): Rule[] {
        const config = preferences
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        return config
            .get<Rule[]>('rules', [])
            .filter((rule) => rule && typeof rule === 'object' && rule.kind)
            .map((rule, index) => ({
                ...rule,
                id: rule.id || `${rule.kind}-${index}`,
                enabled: rule.enabled !== false,
                ...(resolve &&
                rule.kind === 'mapLocal' &&
                rule.file &&
                !isAbsolute(rule.file) &&
                root
                    ? { file: join(root, rule.file) }
                    : {})
            }))
    }

    /** Persist rules to the user's settings; the change event pushes them to the agent. */
    async saveRules(rules: Rule[]) {
        await preferences.update('rules', rules)
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
    /** URL of the MCP endpoint while the agent serves one. */
    get mcpUrl() {
        return this.state.mcpPort ? `http://127.0.0.1:${this.state.mcpPort}/mcp` : undefined
    }
    get connected() {
        return !!this.socket && !this.socket.destroyed
    }

    /** Connect to a running agent or spawn one; resolves once the mirror is populated. */
    connect(): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Tapline client is disposed'))
        if (this.ready) return this.ready
        this.ready = this.establish().catch((error) => {
            this.socket?.destroy()
            this.ready = undefined
            throw error
        })
        return this.ready
    }

    /** Build stamp of the bundled agent script; compared with the running agent's. */
    private build() {
        try {
            return statSync(join(this.context.extensionPath, 'dist', 'agent.js')).mtimeMs
        } catch {
            return undefined
        }
    }

    private async establish(): Promise<void> {
        if (this.disposed) throw new Error('Tapline client is disposed')
        const directory = this.context.globalStorageUri.fsPath
        const path = pipePath(directory)
        const socket = await this.openAgent(directory, path)
        this.attach(socket)
        this.state = await this.request('hello', {
            settings: this.settings(),
            sessionId: this.session || undefined,
            workspaceName: vscode.workspace.name
        })
        const build = this.build()
        const version = this.context.extension?.packageJSON.version as string | undefined
        if (needsAgentUpgrade(version, this.state, build)) {
            await this.upgrade(socket, directory)
            return
        }
        // Same/newer releases must not restart each other across window reloads.
        if (build && this.state.build !== build)
            this.output.info(
                `Reusing compatible capture agent ${this.state.agentVersion ?? ''} (pid ${this.state.pid}) from another build.`
            )
        await this.resync(30000)
    }

    private async openAgent(directory: string, path: string) {
        let socket = await this.dial(path).catch(() => undefined)
        if (!socket) {
            this.spawnAgent(directory, path)
            const deadline = Date.now() + 10000
            while (!socket) {
                await new Promise((r) => setTimeout(r, 150))
                if (this.disposed) throw new Error('Tapline client is disposed')
                socket = await this.dial(path).catch(() => undefined)
                if (!socket && Date.now() > deadline)
                    throw new Error(
                        vscode.l10n.t(
                            'The Tapline capture agent did not start. See the Tapline output channel.'
                        )
                    )
            }
        }
        return socket
    }

    /** Start and health-check the replacement before asking the existing agent to exit. */
    private async upgrade(previous: net.Socket, directory: string) {
        const previousState = this.state
        let replacement: net.Socket | undefined
        let retired = false
        this.upgrading = true
        this.retiringSocket = previous
        try {
            const stagingPath = pipePath(`${directory}:upgrade:${randomUUID()}`)
            replacement = await this.openAgent(directory, stagingPath)
            this.attach(replacement)
            await this.request('hello', {
                settings: { ...this.settings(), mcpPort: 0 },
                sessionId: this.session,
                workspaceName: vscode.workspace.name
            })
            // Starting the core verifies the new binary and allocates its capture port.
            // Keep MCP on the old agent until it releases the shared endpoint.
            await this.request('start', {})
            await this.request('snapshot', {}, 30000)
            if (!previousState.running) await this.request('stop', {}, 30000)
            if (!previousState.recording) await this.request('record', { value: false }, 30000)
            await this.retire(previous)
            retired = true
            await this.request('promote', {}, 30000)
            await this.request('settings', { settings: this.settings() }, 30000)
            await this.resync(30000)
            this.output.info(`Capture agent upgraded successfully (pid ${this.state.pid})`)
        } catch (error) {
            replacement?.destroy()
            if (!retired && !previous.destroyed && !this.disposed) {
                this.socket = previous
                this.state = previousState
                this.output.warn(
                    `Capture agent upgrade failed; keeping the previous version: ${String(error)}`
                )
                await this.resync(30000)
            } else throw error
        } finally {
            this.upgrading = false
            this.retiringSocket = undefined
        }
    }

    /** The old socket is no longer the active RPC channel during staging. */
    private retire(socket: net.Socket) {
        if (socket.destroyed) return Promise.resolve()
        return new Promise<void>((resolve, reject) => {
            const id = ++this.sequence
            const lines = createInterface({ input: socket })
            const finish = (error?: Error) => {
                clearTimeout(timer)
                lines.close()
                socket.off('close', closed)
                socket.off('error', failed)
                if (error) reject(error)
                else resolve()
            }
            const closed = () => finish()
            const failed = (error: Error) => finish(error)
            const timer = setTimeout(
                () => finish(new Error('The older capture agent did not exit')),
                30000
            )
            socket.once('close', closed)
            socket.once('error', failed)
            lines.on('line', (line) => {
                try {
                    const message = JSON.parse(line) as Message
                    if ('id' in message && message.id === id && 'error' in message)
                        finish(new Error(message.error))
                } catch {
                    /* Ignore unrelated malformed messages. */
                }
            })
            socket.write(JSON.stringify({ id, method: 'shutdown' }) + '\n')
        })
    }

    private dial(path: string) {
        return new Promise<net.Socket>((resolve, reject) => {
            const socket = net.connect(path)
            socket.setTimeout(3000, () => socket.destroy(new Error('Agent connection timed out')))
            socket.once('connect', () => {
                socket.setTimeout(0)
                resolve(socket)
            })
            socket.once('error', (error) => {
                socket.destroy()
                reject(error)
            })
        })
    }

    private spawnAgent(directory: string, path: string) {
        const script = join(this.context.extensionPath, 'dist', 'agent.js')
        const core = corePath(this.context)
        this.output.info(`Starting capture agent: ${script} (core ${core})`)
        // The extension host is Electron; ELECTRON_RUN_AS_NODE turns the same binary
        // into a plain Node runtime for the detached agent.
        const child = spawn(process.execPath, [script, directory, core, path], {
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
        child.on('error', (error) =>
            this.output.error(`Capture agent spawn failed: ${error.message}`)
        )
        child.unref()
    }

    private attach(socket: net.Socket) {
        this.socket = socket
        socket.setNoDelay(true)
        createInterface({ input: socket }).on('line', (line) => {
            if (this.socket !== socket) return
            let message: Message
            try {
                message = JSON.parse(line)
            } catch {
                return
            }
            if ('event' in message) {
                if (!this.upgrading) this.receive(message.event)
            } else {
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
            if (!this.upgrading) this.ready = undefined
            for (const waiter of this.pending.values())
                waiter.reject(
                    new Error(vscode.l10n.t('Lost connection to the Tapline capture agent'))
                )
            this.pending.clear()
            this.state = { ...this.state, running: false, clients: 0 }
            this.events.fire({ type: 'state', state: this.state })
            if (!this.disposed && !this.upgrading)
                setTimeout(() => void this.connect().catch(() => {}), 1000)
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
            void this.resync().catch((error) => this.output.error(String(error)))
            return
        }
        this.events.fire(event)
    }

    /** `reset` means the agent's transaction set changed (clear/delete/eviction). */
    private async resync(timeout = 0) {
        const snapshot = await this.request('snapshot', {}, timeout)
        this.transactions.clear()
        for (const t of snapshot.transactions) this.transactions.set(t.id, t)
        this.state = snapshot.state
        this.events.fire({ type: 'state', state: this.state })
    }

    async call<M extends Method>(method: M, args: Args<M>): Promise<Responses[M]> {
        await this.connect()
        return this.request(method, args)
    }

    /** Handshake uses the wire directly; public calls wait for hello and the snapshot. */
    private request<M extends Method>(
        method: M,
        args: Args<M>,
        timeout = ['hello', 'start', 'shutdown'].includes(method) ? 30000 : 0
    ): Promise<Responses[M]> {
        const socket = this.socket
        if (!socket || socket.destroyed)
            return Promise.reject(
                new Error(vscode.l10n.t('Lost connection to the Tapline capture agent'))
            )
        const id = ++this.sequence
        return new Promise<Responses[M]>((resolve, reject) => {
            // Normal RPCs can queue behind a long replay or a user's breakpoint edit.
            // Bound startup/handshake only; do not interrupt those capture operations.
            const timer = !timeout
                ? undefined
                : setTimeout(() => {
                      const error = new Error(
                          vscode.l10n.t(
                              'Tapline capture agent timed out while handling {0}. See the Tapline output channel.',
                              method
                          )
                      )
                      this.output.error(error.message)
                      this.pending.get(id)?.reject(error)
                      socket.destroy()
                  }, timeout)
            const finish = () => {
                clearTimeout(timer)
                this.pending.delete(id)
            }
            this.pending.set(id, {
                resolve: (value) => {
                    finish()
                    resolve(value as Responses[M])
                },
                reject: (error) => {
                    finish()
                    reject(error)
                }
            })
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
    resume(id: string, edit?: BreakpointEdit) {
        return this.apply(this.call('resume', { transaction: id, edit }))
    }
    abort(id: string) {
        return this.apply(this.call('abort', { transaction: id }))
    }

    dispose() {
        this.disposed = true
        this.socket?.destroy()
        this.retiringSocket?.destroy()
        this.events.dispose()
        this.output.dispose()
    }
}
