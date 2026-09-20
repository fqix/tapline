import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { shellEnvironment } from '../utils/shellEnvironment'
import { proxyVariables } from '../utils/environment'

describe('copy proxy environment', () => {
    it.each([
        ['Bash', "export HTTP_PROXY='http://127.0.0.1:3638'"],
        ['Fish', "set -gx HTTP_PROXY 'http://127.0.0.1:3638'"],
        ['Nushell', '$env.HTTP_PROXY = "http://127.0.0.1:3638"'],
        ['CMD', 'set "HTTP_PROXY=http://127.0.0.1:3638"'],
        ['PowerShell', "$env:HTTP_PROXY = 'http://127.0.0.1:3638'"]
    ] as const)('formats %s commands with the active port', (shell, expected) => {
        const result = shellEnvironment(proxyVariables(3638), shell)
        expect(result).toContain(expected)
        expect(result.split(/\r?\n/)).toHaveLength(6)
        expect(result).toContain('localhost,127.0.0.1,::1')
    })

    it.skipIf(process.platform === 'win32')(
        'preserves spaces, quotes, Unicode and shell expressions in Bash',
        () => {
            const value = "/tmp/中文 user's $(printf injected) `printf injected` \\ ca.pem"
            const script = shellEnvironment({ TAPLINE_TEST: value }, 'Bash')
            const result = execFileSync(
                '/bin/bash',
                ['-c', script + '\nprintf %s "$TAPLINE_TEST"'],
                {
                    encoding: 'utf8'
                }
            )
            expect(result).toBe(value)
        }
    )

    it('quotes paths according to each shell', () => {
        const env = { SSL_CERT_FILE: "C:\\User's Files\\ca.pem" }
        expect(shellEnvironment(env, 'Fish')).toBe(
            "set -gx SSL_CERT_FILE 'C:\\\\User\\'s Files\\\\ca.pem'"
        )
        expect(shellEnvironment(env, 'PowerShell')).toBe(
            "$env:SSL_CERT_FILE = 'C:\\User''s Files\\ca.pem'"
        )
        expect(shellEnvironment(env, 'Nushell')).toBe(
            '$env.SSL_CERT_FILE = "C:\\\\User\'s Files\\\\ca.pem"'
        )
        expect(shellEnvironment(env, 'CMD')).toBe('set "SSL_CERT_FILE=C:\\User\'s Files\\ca.pem"')
    })

    it('refuses unsafe CMD expansions and malformed variable names', () => {
        for (const value of ['%USERPROFILE%', 'a!b', 'a" & echo bad', 'a\nb'])
            expect(() => shellEnvironment({ SSL_CERT_FILE: value }, 'CMD')).toThrow()
        expect(() => shellEnvironment({ 'X; echo bad': 'x' }, 'Bash')).toThrow()
    })
})
