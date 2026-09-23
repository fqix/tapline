import { describe, expect, it } from 'vitest'
import {
    matchesSetting,
    settingsCatalog,
    settingsCategories
} from '../../webview/lib/settingsCatalog'
import { preferenceSchema } from '../../shared/preferences'

describe('settings navigation and search', () => {
    it('places every editable setting in a valid category', () => {
        expect(Object.keys(settingsCatalog).sort()).toEqual(
            Object.keys(preferenceSchema)
                .filter((key) => key !== 'rules')
                .sort()
        )
        for (const item of Object.values(settingsCatalog))
            expect(settingsCategories.some((category) => category.id === item.category)).toBe(true)
    })
    it('matches Chinese and English names, descriptions, keys and categories', () => {
        expect(matchesSetting('mcp.port', 'MCP port')).toBe(true)
        expect(matchesSetting('port', '3606')).toBe(true)
        expect(matchesSetting('port', '代理端口')).toBe(true)
        expect(matchesSetting('ssl.hosts', '解密')).toBe(true)
        expect(matchesSetting('ssl.noHosts', '不解密')).toBe(true)
        expect(matchesSetting('ssl.noHosts', 'Bypass HTTPS')).toBe(true)
        expect(matchesSetting('ssl.noProxy', 'NO_PROXY')).toBe(true)
        expect(matchesSetting('ssl.noProxy', '绕过代理')).toBe(true)
        expect(matchesSetting('grpc.protoFiles', 'protoFiles')).toBe(true)
        expect(matchesSetting('terminal.profiles', '终端与调试')).toBe(true)
        expect(matchesSetting('ssl.hosts', '  HOST   patterns ')).toBe(true)
        expect(matchesSetting('mcp.port', 'grpc')).toBe(false)
        expect(matchesSetting('maxEntries', 'limit nonexistent')).toBe(false)
        expect(matchesSetting('maxEntries', '   ')).toBe(true)
    })
})
