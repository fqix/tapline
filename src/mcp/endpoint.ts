// Streamable HTTP MCP endpoint served by the capture agent on the loopback interface.
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import http from 'node:http'
import { createServer, type TrafficSource, type SessionSource } from './server'

export const MCP_PATH = '/mcp'

/**
 * Stateless: every request gets a fresh McpServer bound to the shared traffic source,
 * so any number of clients (Cursor, Claude Code, Copilot, …) can talk to it at once
 * without session bookkeeping.
 */
export class McpEndpoint {
    private server?: http.Server
    port = 0

    constructor(
        private source: TrafficSource | SessionSource,
        private log: (message: string) => void = () => {}
    ) {}

    async listen(port: number) {
        await this.close()
        if (!port) return
        const server = http.createServer((req, res) => void this.handle(req, res))
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(port, '127.0.0.1', () => {
                server.off('error', reject)
                resolve()
            })
        })
        server.on('error', (error) => this.log(`mcp: ${error.message}`))
        this.server = server
        this.port = port
        this.log(`MCP endpoint listening on http://127.0.0.1:${port}${MCP_PATH}`)
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== MCP_PATH) {
            res.writeHead(404, { 'content-type': 'text/plain' }).end(`Tapline MCP: use ${MCP_PATH}`)
            return
        }
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            enableDnsRebindingProtection: true,
            allowedHosts: [
                '127.0.0.1',
                'localhost',
                `127.0.0.1:${this.port}`,
                `localhost:${this.port}`
            ]
        })
        const server = createServer(this.source)
        res.on('close', () => {
            void transport.close()
            void server.close()
        })
        try {
            await server.connect(transport)
            await transport.handleRequest(req, res)
        } catch (error) {
            this.log(`mcp: ${error instanceof Error ? error.message : error}`)
            if (!res.headersSent) res.writeHead(500).end()
        }
    }

    close() {
        const server = this.server
        this.server = undefined
        this.port = 0
        return new Promise<void>((resolve) => {
            if (!server) return resolve()
            server.close(() => resolve())
            server.closeAllConnections()
        })
    }
}
