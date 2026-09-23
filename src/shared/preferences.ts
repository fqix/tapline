export const preferenceSchema: Record<string, PreferenceSchema> = {
    autoStart: {
        type: 'boolean',
        default: false,
        description: '%config.autoStart%'
    },
    port: {
        type: 'integer',
        minimum: 0,
        maximum: 65535,
        default: 3606,
        description: '%config.port%'
    },
    'ssl.hosts': {
        type: 'array',
        items: {
            type: 'string'
        },
        default: ['*'],
        description: '%config.ssl.hosts%'
    },
    maxEntries: {
        type: 'integer',
        minimum: 100,
        maximum: 10000,
        default: 2000,
        description: '%config.maxEntries%'
    },
    maxBodyKiB: {
        type: 'integer',
        minimum: 0,
        maximum: 4096,
        default: 512,
        description: '%config.maxBodyKiB%'
    },
    'terminal.profiles': {
        type: 'array',
        items: {
            type: 'string',
            enum: ['openssl', 'git', 'node', 'python', 'java', 'rust', 'deno', 'grpc']
        },
        default: ['openssl', 'git'],
        description: '%config.terminal.profiles%'
    },
    'mcp.enabled': {
        type: 'boolean',
        default: true,
        description: '%config.mcp.enabled%'
    },
    'mcp.port': {
        type: 'integer',
        minimum: 1024,
        maximum: 65535,
        default: 3607,
        description: '%config.mcp.port%'
    },
    'grpc.protoFiles': {
        type: 'array',
        items: {
            type: 'string'
        },
        default: ['**/*.proto'],
        description: '%config.grpc.protoFiles%'
    },
    rules: {
        type: 'array',
        default: [],
        markdownDescription: '%config.rules%',
        items: {
            type: 'object',
            required: ['kind'],
            properties: {
                id: {
                    type: 'string'
                },
                enabled: {
                    type: 'boolean',
                    default: true
                },
                name: {
                    type: 'string'
                },
                kind: {
                    type: 'string',
                    enum: ['breakpoint', 'rewrite', 'mapLocal', 'mapRemote', 'block', 'throttle'],
                    enumDescriptions: [
                        '%config.rules.kind.breakpoint%',
                        '%config.rules.kind.rewrite%',
                        '%config.rules.kind.mapLocal%',
                        '%config.rules.kind.mapRemote%',
                        '%config.rules.kind.block%',
                        '%config.rules.kind.throttle%'
                    ]
                },
                url: {
                    type: 'string',
                    description: '%config.rules.url%'
                },
                method: {
                    type: 'string',
                    description: '%config.rules.method%'
                },
                request: {
                    type: ['boolean', 'object'],
                    description: '%config.rules.request%',
                    properties: {
                        method: {
                            type: 'string'
                        },
                        url: {
                            type: 'object',
                            properties: {
                                pattern: {
                                    type: 'string'
                                },
                                replacement: {
                                    type: 'string'
                                }
                            },
                            required: ['pattern', 'replacement']
                        },
                        status: {
                            type: 'integer',
                            minimum: 100,
                            maximum: 599
                        },
                        headers: {
                            type: 'object',
                            additionalProperties: {
                                type: ['string', 'null']
                            },
                            description: '%config.rules.headers%'
                        },
                        body: {
                            type: 'string'
                        },
                        bodyReplace: {
                            type: 'object',
                            properties: {
                                pattern: {
                                    type: 'string'
                                },
                                replacement: {
                                    type: 'string'
                                }
                            },
                            required: ['pattern', 'replacement']
                        }
                    }
                },
                response: {
                    type: ['boolean', 'object'],
                    description: '%config.rules.response%',
                    properties: {
                        method: {
                            type: 'string'
                        },
                        url: {
                            type: 'object',
                            properties: {
                                pattern: {
                                    type: 'string'
                                },
                                replacement: {
                                    type: 'string'
                                }
                            },
                            required: ['pattern', 'replacement']
                        },
                        status: {
                            type: 'integer',
                            minimum: 100,
                            maximum: 599
                        },
                        headers: {
                            type: 'object',
                            additionalProperties: {
                                type: ['string', 'null']
                            },
                            description: '%config.rules.headers%'
                        },
                        body: {
                            type: 'string'
                        },
                        bodyReplace: {
                            type: 'object',
                            properties: {
                                pattern: {
                                    type: 'string'
                                },
                                replacement: {
                                    type: 'string'
                                }
                            },
                            required: ['pattern', 'replacement']
                        }
                    }
                },
                file: {
                    type: 'string',
                    description: '%config.rules.file%'
                },
                body: {
                    type: 'string',
                    description: '%config.rules.body%'
                },
                status: {
                    type: 'integer',
                    minimum: 100,
                    maximum: 599
                },
                contentType: {
                    type: 'string'
                },
                to: {
                    type: 'string',
                    description: '%config.rules.to%'
                },
                latencyMs: {
                    type: 'integer',
                    minimum: 0
                },
                kbps: {
                    type: 'integer',
                    minimum: 1
                }
            }
        }
    }
}

export interface PreferenceSchema {
    type: string | string[]
    enumDescriptions?: string[]
    markdownDescription?: string
    default?: unknown
    minimum?: number
    maximum?: number
    enum?: string[]
    items?: PreferenceSchema
    properties?: Record<string, PreferenceSchema>
    additionalProperties?: boolean | PreferenceSchema
    required?: string[]
    description?: string
}
export const preferenceDescriptions: Record<string, { en: string; zh: string }> = {
    autoStart: {
        en: 'Start capture when VS Code opens.',
        zh: 'VS Code 启动时自动开始抓包。'
    },
    port: {
        en: 'Port for the capture proxy. Defaults to 3606. Set to 0 to ask the OS for a free port.',
        zh: '抓包代理的监听端口。默认 3606。设为 0 表示由系统自动分配空闲端口。'
    },
    'ssl.hosts': {
        en: 'Host patterns whose HTTPS traffic is decrypted (wildcards allowed). An empty list captures without decryption, and then no root certificate has to be trusted.',
        zh: '需要解密 HTTPS 流量的主机模式（支持通配符）。留空则只抓包不解密，此时也不需要信任根证书。'
    },
    maxEntries: {
        en: 'Maximum live transactions kept in memory.',
        zh: '内存中保留的最大请求条数。'
    },
    maxBodyKiB: {
        en: 'Maximum request/response body bytes retained per direction, in KiB. Traffic is forwarded in full; larger bodies are marked truncated.',
        zh: '每个方向保留的请求/响应体上限（KiB）。流量本身完整转发，超出部分标记为已截断。'
    },
    'terminal.profiles': {
        en: 'Which sets of environment variables every new terminal gets besides the proxy variables (HTTP_PROXY, HTTPS_PROXY, NO_PROXY). Each name stands for the variables a runtime reads to trust the Tapline CA; the resolved variables are listed below. Keep this generic and use "New Captured Terminal" for a runtime-specific terminal.',
        zh: '除代理变量（HTTP_PROXY、HTTPS_PROXY、NO_PROXY）外，每个新终端还要注入哪几组环境变量。每个名称代表某类运行时用来信任 Tapline CA 的一组变量，实际注入的变量见下方列表。建议保持通用，需要特定运行时时用"新建抓包终端"。'
    },
    'mcp.enabled': {
        en: 'Serve an MCP endpoint (http://127.0.0.1:<port>/mcp) so AI assistants such as Copilot, Claude Code and Cursor can read and replay captured traffic.',
        zh: '提供 MCP 端点（http://127.0.0.1:<端口>/mcp），让 Copilot、Claude Code、Cursor 等 AI 助手读取和重放抓到的流量。'
    },
    'mcp.port': {
        en: 'Loopback port of the MCP endpoint.',
        zh: 'MCP 端点的本地回环端口。'
    },
    'grpc.protoFiles': {
        en: 'Glob patterns (relative to the workspace) or absolute paths of .proto files used to decode gRPC messages with field names. Without a matching schema, messages are decoded by field number.',
        zh: '用于解码 gRPC 消息的 .proto 文件：相对工作区的 glob 或绝对路径。没有匹配的 schema 时按字段编号解码。'
    },
    rules: {
        en: 'rules',
        zh: 'rules'
    }
}
