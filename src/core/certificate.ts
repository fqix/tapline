import forge from 'node-forge'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'

export interface RootIdentity {
    certificate: string
    key: string
}

/**
 * Root CA files: `ca.pem` (public, share with clients), `ca.key` (0600) and
 * `ca.p12`, a PKCS#12 trust store for Java holding the public roots plus the CA.
 */
export function certificatePaths(directory: string) {
    return {
        certificate: join(directory, 'ca.pem'),
        key: join(directory, 'ca.key'),
        truststore: join(directory, 'ca.p12')
    }
}

/** Password Java expects for a PKCS#12 trust store; the store holds no private keys. */
export const TRUSTSTORE_PASSWORD = 'changeit'

/**
 * Build `ca.p12` from Node's bundled Mozilla roots plus the Tapline CA so a JVM
 * pointed at it still trusts hosts whose TLS is tunnelled rather than decrypted.
 */
export function ensureTruststore(directory: string, certificate: string): string {
    const path = certificatePaths(directory).truststore
    if (existsSync(path)) return path
    // Keep raw DER: node-forge cannot parse every modern (ECDSA) root, and the
    // store only needs the bytes.
    const certs = [certificate, ...rootCertificates].map((pem) => forge.pem.decode(pem)[0].body)
    const asn1 = trustStoreAsn1(certs, TRUSTSTORE_PASSWORD)
    writeFileSync(path, Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'), { mode: 0o644 })
    return path
}

let generating: Promise<RootIdentity> | undefined

/** Load or create the Tapline root CA (RSA 2048, 10 years, CA:TRUE). */
export function ensureRootIdentity(directory: string): Promise<RootIdentity> {
    const paths = certificatePaths(directory)
    if (existsSync(paths.certificate) && existsSync(paths.key))
        return Promise.resolve({
            certificate: readFileSync(paths.certificate, 'utf8'),
            key: readFileSync(paths.key, 'utf8')
        })
    return (generating ??= generate(directory).finally(() => (generating = undefined)))
}

async function generate(directory: string): Promise<RootIdentity> {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const pair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) =>
        forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (error, keys) =>
            error ? reject(error) : resolve(keys)
        )
    )
    const cert = forge.pki.createCertificate()
    cert.publicKey = pair.publicKey
    cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15))
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000)
    const subject = [
        { name: 'commonName', value: 'Tapline Root CA' },
        { name: 'organizationName', value: 'Tapline' }
    ]
    cert.setSubject(subject)
    cert.setIssuer(subject)
    cert.setExtensions([
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
        { name: 'subjectKeyIdentifier' }
    ])
    cert.sign(pair.privateKey, forge.md.sha256.create())
    const identity = {
        certificate: forge.pki.certificateToPem(cert),
        key: forge.pki.privateKeyToPem(pair.privateKey)
    }
    const paths = certificatePaths(directory)
    writeFileSync(paths.key, identity.key, { mode: 0o600 })
    chmodSync(paths.key, 0o600)
    writeFileSync(paths.certificate, identity.certificate, { mode: 0o644 })
    return identity
}

/**
 * Encode a PKCS#12 trust store by hand: node-forge's builder omits the Oracle
 * `trustedKeyUsage` bag attribute, without which a JDK ignores certificate-only
 * bags. Unencrypted safe contents (public certificates only) with a SHA-1 MAC.
 */
function trustStoreAsn1(certs: string[], password: string) {
    const { asn1, pki, util, random, md, hmac } = forge
    const { Class, Type, create } = asn1
    const oid = (value: string) =>
        create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(value).getBytes())
    const octets = (bytes: string) => create(Class.UNIVERSAL, Type.OCTETSTRING, false, bytes)
    const bags = certs.map((cert, index) =>
        create(Class.UNIVERSAL, Type.SEQUENCE, true, [
            oid(pki.oids.certBag),
            create(Class.CONTEXT_SPECIFIC, 0, true, [
                create(Class.UNIVERSAL, Type.SEQUENCE, true, [
                    oid(pki.oids.x509Certificate),
                    create(Class.CONTEXT_SPECIFIC, 0, true, [octets(cert)])
                ])
            ]),
            create(Class.UNIVERSAL, Type.SET, true, [
                create(Class.UNIVERSAL, Type.SEQUENCE, true, [
                    oid(pki.oids.friendlyName),
                    create(Class.UNIVERSAL, Type.SET, true, [
                        create(
                            Class.UNIVERSAL,
                            Type.BMPSTRING,
                            false,
                            util.encodeUtf8(`tapline-${index}`).replace(/./g, (c) => '\0' + c)
                        )
                    ])
                ]),
                // Oracle trusted-certificate marker: anyExtendedKeyUsage
                create(Class.UNIVERSAL, Type.SEQUENCE, true, [
                    oid('2.16.840.1.113894.746875.1.1'),
                    create(Class.UNIVERSAL, Type.SET, true, [oid('2.5.29.37.0')])
                ])
            ])
        ])
    )
    const safeContents = create(Class.UNIVERSAL, Type.SEQUENCE, true, bags)
    const contentInfo = create(Class.UNIVERSAL, Type.SEQUENCE, true, [
        oid(pki.oids.data),
        create(Class.CONTEXT_SPECIFIC, 0, true, [octets(asn1.toDer(safeContents).getBytes())])
    ])
    const authenticatedSafe = create(Class.UNIVERSAL, Type.SEQUENCE, true, [contentInfo])
    const safeBytes = asn1.toDer(authenticatedSafe).getBytes()
    const salt = random.getBytesSync(8)
    const iterations = 2048
    const key = forge.pkcs12.generateKey(
        password,
        util.createBuffer(salt),
        3,
        iterations,
        20,
        md.sha1.create()
    )
    const mac = hmac.create()
    mac.start('sha1', key)
    mac.update(safeBytes)
    const macData = create(Class.UNIVERSAL, Type.SEQUENCE, true, [
        create(Class.UNIVERSAL, Type.SEQUENCE, true, [
            create(Class.UNIVERSAL, Type.SEQUENCE, true, [
                oid(pki.oids.sha1),
                create(Class.UNIVERSAL, Type.NULL, false, '')
            ]),
            octets(mac.digest().getBytes())
        ]),
        octets(salt),
        create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(iterations).getBytes())
    ])
    return create(Class.UNIVERSAL, Type.SEQUENCE, true, [
        create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(3).getBytes()),
        create(Class.UNIVERSAL, Type.SEQUENCE, true, [
            oid(pki.oids.data),
            create(Class.CONTEXT_SPECIFIC, 0, true, [octets(safeBytes)])
        ]),
        macData
    ])
}
