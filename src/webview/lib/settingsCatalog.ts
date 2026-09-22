import { preferenceDescriptions } from '../../shared/preferences'

export const settingsCategories = [
    { id: 'general', en: 'General', zh: '常规' },
    { id: 'capture', en: 'Capture & HTTPS', zh: '抓包与 HTTPS' },
    { id: 'environment', en: 'Terminal & Debug', zh: '终端与调试' },
    { id: 'mcp', en: 'MCP', zh: 'MCP' },
    { id: 'grpc', en: 'gRPC', zh: 'gRPC' }
] as const
export type SettingsCategory = (typeof settingsCategories)[number]['id'] | 'all'
export const settingsCatalog: Record<
    string,
    { category: SettingsCategory; en: string; zh: string }
> = {
    autoStart: { category: 'general', en: 'Start capture automatically', zh: '自动开始抓包' },
    port: { category: 'capture', en: 'Preferred proxy port', zh: '首选代理端口' },
    'ssl.enabled': { category: 'capture', en: 'Decrypt HTTPS', zh: 'HTTPS 解密' },
    'ssl.hosts': { category: 'capture', en: 'HTTPS host patterns', zh: 'HTTPS 主机匹配规则' },
    maxEntries: { category: 'capture', en: 'Request limit', zh: '请求数量上限' },
    maxBodyKiB: { category: 'capture', en: 'Body size limit (KiB)', zh: '正文大小上限（KiB）' },
    'terminal.inject': {
        category: 'environment',
        en: 'Capture new terminals',
        zh: '抓取新终端流量'
    },
    'terminal.profiles': {
        category: 'environment',
        en: 'Environment variables for new terminals',
        zh: '新终端注入的环境变量'
    },
    'debug.inject': {
        category: 'environment',
        en: 'Capture debug sessions',
        zh: '抓取调试会话流量'
    },
    'debug.runtimes': {
        category: 'environment',
        en: 'Environment variables for debug sessions',
        zh: '调试会话注入的环境变量'
    },
    'mcp.enabled': { category: 'mcp', en: 'Enable MCP server', zh: '启用 MCP 服务' },
    'mcp.port': { category: 'mcp', en: 'MCP port', zh: 'MCP 端口' },
    'grpc.protoFiles': { category: 'grpc', en: 'Protobuf schemas', zh: 'Protobuf 文件' }
}

/** Match every search term against names, descriptions, keys and category labels. */
export function matchesSetting(key: string, query: string): boolean {
    const item = settingsCatalog[key]
    const category = settingsCategories.find((category) => category.id === item?.category)
    const description = preferenceDescriptions[key]
    const text = [
        key,
        item?.en,
        item?.zh,
        category?.en,
        category?.zh,
        description?.en,
        description?.zh
    ]
        .join(' ')
        .toLowerCase()
    return query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .every((term) => text.includes(term))
}
