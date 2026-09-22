/**
 * TypeScript HTTP Client Examples (GET, POST, DELETE)
 *
 * Uses native fetch (Node.js 18+, Bun, Deno).
 * Automatically enables EnvHttpProxyAgent if run in Node with HTTP_PROXY / HTTPS_PROXY.
 *
 * Run directly via:
 *   node --experimental-strip-types examples/ts/main.ts
 * or
 *   npx tsx examples/ts/main.ts
 */

interface HttpResponseData {
    args?: Record<string, string>
    headers?: Record<string, string>
    data?: string
    json?: unknown
}

function getBaseUrl(): string {
    return process.env.HTTPBIN || process.env.BASE_URL || 'https://httpbin.org'
}

function printSnippet(text: string): void {
    if (text.length > 200) {
        console.log(`    Body: ${text.slice(0, 200)}...`)
    } else {
        console.log(`    Body: ${text}`)
    }
}

async function configureProxyIfAvailable(): Promise<void> {
    const proxy =
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY ||
        process.env.https_proxy ||
        process.env.http_proxy
    if (!proxy) return

    try {
        const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
        if (typeof EnvHttpProxyAgent === 'function' && typeof setGlobalDispatcher === 'function') {
            setGlobalDispatcher(new EnvHttpProxyAgent())
            return
        }
    } catch {
        // undici package not installed in node_modules
    }

    if (!process.env.NODE_USE_ENV_PROXY) {
        console.warn(
            `\n⚠️  [Tapline] Proxy environment detected (${proxy}).\n` +
                `   For Node.js native fetch to route through the proxy, please run with:\n` +
                `   NODE_USE_ENV_PROXY=1 node --experimental-strip-types examples/ts/main.ts\n` +
                `   (or run 'npm install' in examples/ts/ to enable undici proxy dispatch)\n`
        )
    }
}

async function runGet(baseUrl: string): Promise<void> {
    const url = `${baseUrl}/get?lang=ts&sample=tapline`
    console.log(`--> GET ${url}`)
    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'tapline-ts-example/1.0',
                Accept: 'application/json'
            }
        })
        const text = await resp.text()
        console.log(`<-- ${resp.status} ${resp.statusText} (${text.length} bytes)`)
        printSnippet(text)
    } catch (err) {
        console.error(`GET request failed:`, err)
    }
    console.log()
}

async function runPost(baseUrl: string): Promise<void> {
    const url = `${baseUrl}/post`
    const payload = {
        client: 'tapline-ts',
        action: 'create',
        timestamp: new Date().toISOString()
    }
    const bodyString = JSON.stringify(payload)
    console.log(`--> POST ${url} (json body: ${bodyString})`)

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'User-Agent': 'tapline-ts-example/1.0',
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: bodyString
        })
        const text = await resp.text()
        console.log(`<-- ${resp.status} ${resp.statusText} (${text.length} bytes)`)
        printSnippet(text)
    } catch (err) {
        console.error(`POST request failed:`, err)
    }
    console.log()
}

async function runDelete(baseUrl: string): Promise<void> {
    const url = `${baseUrl}/delete?id=42`
    console.log(`--> DELETE ${url}`)
    try {
        const resp = await fetch(url, {
            method: 'DELETE',
            headers: {
                'User-Agent': 'tapline-ts-example/1.0',
                Accept: 'application/json'
            }
        })
        const text = await resp.text()
        console.log(`<-- ${resp.status} ${resp.statusText} (${text.length} bytes)`)
        printSnippet(text)
    } catch (err) {
        console.error(`DELETE request failed:`, err)
    }
    console.log()
}

async function main(): Promise<void> {
    await configureProxyIfAvailable()

    const baseUrl = getBaseUrl()
    console.log(`=== Running TypeScript HTTP Client Examples (Base: ${baseUrl}) ===\n`)

    await runGet(baseUrl)
    await runPost(baseUrl)
    await runDelete(baseUrl)

    console.log('=== Finished TypeScript HTTP Client Examples ===')
}

await main()
