import { Engine } from '../core/engine'
import { Inspector, verifyCore, type Handlers } from '../core/inspector'

/**
 * A configured port that the OS refuses to hand out. Only these fall back to a free
 * port; a core that timed out or predates window inlets has to surface its own error.
 */
const isPortUnavailable = (error: unknown) =>
    /address (already )?in use|EADDRINUSE|normally permitted|permission denied|EACCES/i.test(
        error instanceof Error ? error.message : String(error)
    )

/** One transport process, with an OS-bound inlet and policy engine per capture session. */
export class SharedCore {
    get pid() {
        return this.inspector?.pid
    }
    private inspector?: Inspector
    private version?: string
    private targets = new Map<string, Engine>()
    private requests = new Map<string, Engine>()
    private tags = new Map<Engine, string>()
    private queue: Promise<unknown> = Promise.resolve()

    constructor(
        private directory: string,
        private corePath: string
    ) {}

    register(engine: Engine, tag: string) {
        this.tags.set(engine, tag)
    }

    private serial<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation)
        this.queue = result.catch(() => {})
        return result
    }

    start(engine: Engine): Promise<Inspector> {
        return this.serial(async () => {
            const tag = this.tags.get(engine)!
            if (!this.inspector) {
                const manifest = await verifyCore(this.corePath)
                this.version = manifest.version
                const root = await engine.prepareCertificates()
                const handlers = new Proxy({} as Handlers, {
                    get:
                        (_, method: keyof Handlers) =>
                        (...args: any[]) => {
                            if (method === 'log') {
                                for (const target of this.targets.values())
                                    target.log(args[0], args[1])
                                return
                            }
                            const target = this.requests.get(args[0])
                            if (!target) {
                                if (method === 'request') return { abort: 'Capture session closed' }
                                return false
                            }
                            const result = (target[method] as Function).apply(target, args)
                            if (method === 'closed' || method === 'failure')
                                this.requests.delete(args[0])
                            return result
                        }
                })
                const inspector = new Inspector(
                    {
                        corePath: this.corePath,
                        directory: this.directory,
                        host: '127.0.0.1',
                        port: 0,
                        root,
                        dynamicInbounds: true,
                        intercept: (host, inbound) =>
                            Boolean(inbound && this.targets.get(inbound)?.intercepts(host)),
                        bindSession: (id, inbound) => {
                            const target = this.targets.get(inbound)
                            if (!target) throw new Error('Unknown capture inlet')
                            const previous = this.requests.get(id)
                            if (previous && previous !== target)
                                throw new Error('Capture session mismatch')
                            this.requests.set(id, target)
                        }
                    },
                    handlers
                )
                inspector.onExit(() => {
                    if (this.inspector !== inspector) return
                    this.inspector = undefined
                    for (const target of this.targets.values()) {
                        target.running = false
                        target.emit('event', { type: 'reset' })
                    }
                    this.targets.clear()
                    for (const [id, target] of this.requests)
                        target.failure(id, 'Capture core exited')
                    this.requests.clear()
                })
                await inspector.start()
                this.inspector = inspector
            }
            engine.coreVersion = this.version
            this.targets.set(tag, engine)
            try {
                // The configured port (0 asks the OS for a free one); a busy port falls
                // back to a free one so a second window never blocks on the first.
                const desired = engine.settings.port
                try {
                    engine.settings.port = await this.inspector.inlet('add', tag, desired)
                } catch (error) {
                    if (!desired || !isPortUnavailable(error)) throw error
                    engine.log(`Port ${desired} is unavailable, using a free port instead`, 'warn')
                    engine.settings.port = await this.inspector.inlet('add', tag, 0)
                }
                return this.inspector
            } catch (error) {
                this.targets.delete(tag)
                if (!this.targets.size) {
                    await this.inspector.stop()
                    this.inspector = undefined
                }
                throw error
            }
        })
    }

    stop(engine: Engine): Promise<void> {
        return this.serial(async () => {
            const tag = this.tags.get(engine)!
            if (!this.targets.has(tag)) return
            // Close ingress and existing core connections before dropping policy bindings.
            await this.inspector?.inlet('remove', tag)
            this.targets.delete(tag)
            for (const [id, target] of this.requests)
                if (target === engine) this.requests.delete(id)
            if (!this.targets.size) {
                const inspector = this.inspector
                this.inspector = undefined
                await inspector?.stop()
            }
        })
    }

    forget(engine: Engine) {
        this.tags.delete(engine)
    }

    close(): Promise<void> {
        return this.serial(async () => {
            const inspector = this.inspector
            this.inspector = undefined
            await inspector?.stop()
            this.targets.clear()
            this.requests.clear()
            this.tags.clear()
        })
    }
}
