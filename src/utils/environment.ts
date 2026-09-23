// Environment injected into terminals and debug sessions while capture runs.
// Variables are grouped by the runtime that reads them so a Node debug session
// never sees JAVA_TOOL_OPTIONS and a JVM never sees NODE_USE_ENV_PROXY.

export interface CaptureTarget {
    port: number
    certificatePath: string
    /** Public roots plus Tapline, for replacement CA settings. */
    caBundlePath?: string
    /** PKCS#12 trust store for JVMs when TLS decryption is enabled. */
    truststorePath?: string
    /** Configured decryption patterns; an empty list preserves native CA trust. */
    sslHosts?: readonly string[]
    /** Exclusions take precedence over the decryption patterns. */
    sslNoHosts?: readonly string[]
}

export type Profile = 'openssl' | 'git' | 'node' | 'python' | 'java' | 'rust' | 'deno' | 'grpc'

export const PROFILES: Profile[] = [
    'openssl',
    'git',
    'node',
    'python',
    'java',
    'rust',
    'deno',
    'grpc'
]

/** Human-readable descriptions, used by settings and the terminal picker. */
export const profileDescriptions: Record<Profile, string> = {
    openssl:
        'curl, wget, Go, Ruby, PHP and other OpenSSL-based tools (SSL_CERT_FILE, CURL_CA_BUNDLE)',
    git: 'git over HTTPS (GIT_SSL_CAINFO)',
    node: 'Node.js and Bun (NODE_EXTRA_CA_CERTS, NODE_USE_ENV_PROXY, npm_config_cafile)',
    python: 'Python requests, pip, boto3 / aws cli (REQUESTS_CA_BUNDLE, PIP_CERT, AWS_CA_BUNDLE)',
    java: 'Any JVM (JAVA_TOOL_OPTIONS with proxy properties and a PKCS#12 trust store)',
    rust: 'cargo (CARGO_HTTP_CAINFO)',
    deno: 'Deno (DENO_CERT)',
    grpc: 'gRPC C-core clients (GRPC_DEFAULT_SSL_ROOTS_FILE_PATH)'
}

/** Always injected: the proxy itself. Every common HTTP client reads these. */
export function proxyVariables(
    port: number,
    extraNoProxy?: readonly string[]
): Record<string, string> {
    const proxy = `http://127.0.0.1:${port}`
    const defaults = ['localhost', '127.0.0.1', '::1']
    // Shared with the webview bundle, where `process` does not exist: reach for it
    // through globalThis so the host's own NO_PROXY is honoured without a hard import.
    const procEnv = (
        globalThis as unknown as {
            process?: { env?: Record<string, string | undefined> }
        }
    ).process?.env
    const envNoProxy = procEnv?.NO_PROXY || procEnv?.no_proxy || ''
    const existing = envNoProxy
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    const combined = Array.from(new Set([...defaults, ...existing, ...(extraNoProxy ?? [])])).join(
        ','
    )
    return {
        http_proxy: proxy,
        https_proxy: proxy,
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        NO_PROXY: combined,
        no_proxy: combined
    }
}

const proxyProfileVariables: Partial<Record<Profile, Record<string, string>>> = {
    node: { NODE_USE_ENV_PROXY: '1' }
}

const variables: Record<
    Profile,
    (target: CaptureTarget, noProxy: string, decryptTLS: boolean) => Record<string, string>
> = {
    openssl: ({ certificatePath }) => ({
        SSL_CERT_FILE: certificatePath,
        CURL_CA_BUNDLE: certificatePath
    }),
    git: ({ certificatePath }) => ({ GIT_SSL_CAINFO: certificatePath }),
    node: ({ certificatePath }) => ({
        NODE_EXTRA_CA_CERTS: certificatePath,
        npm_config_cafile: certificatePath
    }),
    python: ({ certificatePath }) => ({
        REQUESTS_CA_BUNDLE: certificatePath,
        PIP_CERT: certificatePath,
        AWS_CA_BUNDLE: certificatePath
    }),
    java: ({ port, truststorePath }, noProxy, decryptTLS): Record<string, string> =>
        truststorePath || !decryptTLS
            ? {
                  // JVMs ignore HTTP_PROXY; JAVA_TOOL_OPTIONS is read by every JVM at start.
                  JAVA_TOOL_OPTIONS: [
                      `-Dhttp.proxyHost=127.0.0.1`,
                      `-Dhttp.proxyPort=${port}`,
                      `-Dhttps.proxyHost=127.0.0.1`,
                      `-Dhttps.proxyPort=${port}`,
                      `-Dhttp.nonProxyHosts=${quoteJavaOption(javaNonProxyHosts(noProxy))}`,
                      ...(decryptTLS && truststorePath
                          ? [
                                `-Djavax.net.ssl.trustStore=${quoteJavaOption(truststorePath)}`,
                                `-Djavax.net.ssl.trustStorePassword=changeit`,
                                `-Djavax.net.ssl.trustStoreType=PKCS12`
                            ]
                          : [])
                  ].join(' ')
              }
            : {},
    rust: ({ certificatePath }) => ({ CARGO_HTTP_CAINFO: certificatePath }),
    deno: ({ certificatePath }) => ({ DENO_CERT: certificatePath }),
    grpc: ({ certificatePath }) => ({ GRPC_DEFAULT_SSL_ROOTS_FILE_PATH: certificatePath })
}

/** Proxy variables plus the CA variables of the selected profiles. */
export function captureEnvironment(
    target: CaptureTarget,
    profiles: readonly Profile[],
    extraNoProxy?: readonly string[]
): Record<string, string> {
    const env = proxyVariables(target.port, extraNoProxy)
    const hosts = target.sslHosts ?? ['*']
    const excludesAll =
        hosts.some((host) => host.trim().startsWith('!') && host.trim().slice(1).trim() === '*') ||
        target.sslNoHosts?.some((host) => host.trim() === '*')
    const decryptTLS =
        !excludesAll && hosts.some((host) => host.trim() && !host.trim().startsWith('!'))
    const trustTarget = {
        ...target,
        certificatePath: target.caBundlePath || target.certificatePath
    }
    for (const profile of profiles) {
        Object.assign(env, proxyProfileVariables[profile])
        if ((decryptTLS || profile === 'java') && profile in variables) {
            const values = variables[profile](trustTarget, env.NO_PROXY, decryptTLS)
            // Node adds this CA to its native roots instead of replacing them.
            if (values.NODE_EXTRA_CA_CERTS) values.NODE_EXTRA_CA_CERTS = target.certificatePath
            Object.assign(env, values)
        }
    }
    return env
}

/** JVM patterns use | and require an explicit wildcard for domain suffixes. */
function javaNonProxyHosts(noProxy: string): string {
    const hosts = noProxy.split(',').flatMap((entry) => {
        const host = entry.trim().replace(/^\./, '')
        // JVM nonProxyHosts cannot express CIDRs or port-specific bypasses.
        if (!host || host.includes('/') || /^[^:]+:\d+$/.test(host)) return []
        if (host.includes(':')) return [host.startsWith('[') ? host : `[${host}]`]
        if (host.includes('*') || /^[\d.]+$/.test(host)) return [host]
        return [host, `*.${host}`]
    })
    return [...new Set(hosts)].join('|')
}

/** JAVA_TOOL_OPTIONS splits on whitespace unless the value is double-quoted. */
function quoteJavaOption(value: string) {
    return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/** Default profiles per debug configuration type. Types not listed are left alone. */
export const defaultDebugRuntimes: Record<string, Profile[]> = {
    node: ['node', 'grpc'],
    'pwa-node': ['node', 'grpc'],
    extensionHost: ['node', 'grpc'],
    'pwa-extensionHost': ['node', 'grpc'],
    'node-terminal': ['node', 'grpc'],
    bun: ['node'],
    deno: ['deno'],
    python: ['python', 'openssl', 'grpc'],
    debugpy: ['python', 'openssl', 'grpc'],
    go: ['openssl', 'grpc'],
    java: ['java'],
    kotlin: ['java'],
    lldb: ['openssl', 'grpc'],
    cppdbg: ['openssl', 'grpc'],
    'cargo-test': ['openssl', 'rust'],
    dart: [],
    php: ['openssl'],
    ruby: ['openssl'],
    rdbg: ['openssl'],
    coreclr: []
}

/** Default profiles for the global terminal environment: generic tools only. */
export const defaultTerminalProfiles: Profile[] = ['openssl', 'git']
