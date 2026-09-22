import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importCurl } from '../../utils/curl'

interface Example {
    command: string
    primary: boolean
    excluded?: string
    error?: string
    expected?: { method: string; url: string; headers: Record<string, string>; body: string }
    forms?: string[]
    missingFiles?: string[]
    absentHeaders?: string[]
    limitations?: string[]
}
const corpus: { pages: { title: string; url: string; examples: Example[] }[] } = JSON.parse(
    readFileSync(new URL('../fixtures/reqbin-curl.json', import.meta.url), 'utf8')
)
const limitationMessages: Record<string, string> = {
    'multiple-urls': 'URLs, only the first one',
    'multiple-commands': 'curl requests, only converting the first one',
    'cookie-file': 'passing a file for --cookie/-b is not supported'
}

describe('ReqBin cURL demo corpus', () => {
    it('covers all 48 index entries with a tested primary demo', () => {
        expect(corpus.pages).toHaveLength(48)
        expect(new Set(corpus.pages.map((page) => page.url)).size).toBe(48)
        for (const page of corpus.pages) {
            expect(page.examples[0].primary).toBe(true)
            expect(page.examples[0].expected, page.url).toBeDefined()
            for (const example of page.examples)
                expect(
                    [example.expected, example.error, example.excluded].filter(Boolean)
                ).toHaveLength(1)
        }
    })
    for (const page of corpus.pages) {
        describe(page.url, () => {
            for (const [index, example] of page.examples.entries()) {
                if (example.excluded) continue
                it(`example ${index + 1}: ${example.command.split('\n')[0]}`, async () => {
                    if (example.error) {
                        await expect(importCurl(example.command)).rejects.toThrow()
                        return
                    }
                    const result = await importCurl(example.command)
                    const expected = example.expected!
                    expect(result.method).toBe(expected.method)
                    expect(result.url).toBe(expected.url)
                    const headers = Object.fromEntries(
                        result.headers.split('\n').map((line) => {
                            const colon = line.indexOf(':')
                            return [
                                line.slice(0, colon).toLowerCase(),
                                line.slice(colon + 1).trim()
                            ]
                        })
                    )
                    expect(headers).toMatchObject(expected.headers)
                    for (const name of example.absentHeaders ?? [])
                        expect(headers).not.toHaveProperty(name)
                    if (example.forms) {
                        expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
                        for (const form of example.forms) {
                            const [name, value] = form.split('=')
                            expect(result.body).toContain(`name="${name}"`)
                            if (value.startsWith('@')) {
                                expect(result.body).toContain(value.slice(1))
                                expect(result.warnings.join('\n')).toContain(value.slice(1))
                            } else expect(result.body).toContain(`\n\n${value}\n`)
                        }
                    } else expect(result.body).toBe(expected.body)
                    for (const name of example.missingFiles ?? [])
                        expect(result.warnings.join('\n')).toContain(name)
                    for (const limitation of example.limitations ?? [])
                        expect(result.warnings.join('\n')).toContain(
                            limitationMessages[limitation] ?? limitation
                        )
                    if (!example.limitations && !example.missingFiles)
                        expect(result.warnings).toEqual([])
                })
                if (example.missingFiles) {
                    it(`example ${index + 1}: resolves its data file`, async () => {
                        const readNames: string[] = []
                        const result = await importCurl(example.command, async (name) => {
                            readNames.push(name)
                            return Buffer.from('{\r\n"demo":true\r\n}\r\n')
                        })
                        expect(readNames).toEqual(example.missingFiles)
                        expect(result).toMatchObject({
                            method: example.expected!.method,
                            url: example.expected!.url,
                            body: '{"demo":true}',
                            warnings: []
                        })
                    })
                }
            }
        })
    }
})
