import { describe, expect, it } from 'vitest'
import forge from 'node-forge'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureRootIdentity, ensureTruststore, TRUSTSTORE_PASSWORD } from '../../core/certificate'

describe('Java trust store', () => {
    it('contains the Tapline CA and the public roots', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'tapline-p12-'))
        const root = await ensureRootIdentity(directory)
        const path = ensureTruststore(directory, root.certificate)
        const p12 = forge.pkcs12.pkcs12FromAsn1(
            forge.asn1.fromDer(readFileSync(path).toString('binary')),
            TRUSTSTORE_PASSWORD
        )
        const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
        const subjects = certs.map((bag) => bag.cert?.subject.getField('CN')?.value)
        expect(subjects).toContain('Tapline Root CA')
        expect(certs.length).toBeGreaterThan(100)
        // Second call reuses the file.
        expect(ensureTruststore(directory, root.certificate)).toBe(path)
        // When a JDK is available, make sure keytool can read what we wrote.
        let keytool: string | undefined
        try {
            keytool = execFileSync(
                'keytool',
                [
                    '-list',
                    '-keystore',
                    path,
                    '-storepass',
                    TRUSTSTORE_PASSWORD,
                    '-storetype',
                    'PKCS12'
                ],
                {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }
            )
        } catch {
            return
        }
        expect(keytool).toMatch(/trustedCertEntry/)
        expect(keytool).toMatch(/contains \d+ entries/)
    }, 60000)
})
