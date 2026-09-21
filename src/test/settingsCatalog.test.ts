import { describe, expect, it } from 'vitest'
import { matchesSetting, settingsCatalog, settingsCategories } from '../webview/lib/settingsCatalog'
import { preferenceSchema } from '../shared/preferences'

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
        expect(matchesSetting('ssl.enabled', '解密')).toBe(true)
        expect(matchesSetting('grpc.protoFiles', 'protoFiles')).toBe(true)
        expect(matchesSetting('terminal.inject', '终端与调试')).toBe(true)
        expect(matchesSetting('ssl.hosts', '  HOST   patterns ')).toBe(true)
        expect(matchesSetting('mcp.port', 'grpc')).toBe(false)
        expect(matchesSetting('port', 'port nonexistent')).toBe(false)
        expect(matchesSetting('port', '   ')).toBe(true)
    })
})
