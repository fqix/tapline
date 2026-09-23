import { describe, expect, it } from 'vitest'
import { isHostIntercepted } from '../../shared/model'
import { Engine } from '../../core/engine'

describe('engine SSL policy', () => {
    it('decrypts all hosts by default', () => {
        const engine = new Engine('', '')
        expect(engine.settings.sslHosts).toEqual(['*'])
        expect(engine.intercepts('example.com')).toBe(true)
        expect(engine.intercepts('127.0.0.1')).toBe(true)
    })

    it('applies exclusions before exact and wildcard inclusions, including live changes', () => {
        const engine = new Engine('', '')
        engine.settings.sslHosts = ['*', 'api.private.test', '!negative.test']
        engine.settings.sslNoHosts = ['*.private.test']
        expect(engine.intercepts('api.private.test')).toBe(false)
        expect(engine.intercepts('private.test')).toBe(false)
        expect(engine.intercepts('negative.test')).toBe(false)
        expect(engine.intercepts('public.test')).toBe(true)
        engine.settings.sslNoHosts = []
        expect(engine.intercepts('api.private.test')).toBe(true)
        engine.settings.sslHosts = []
        expect(engine.intercepts('public.test')).toBe(false)
    })
})

describe('isHostIntercepted', () => {
    it('returns false for empty pattern list', () => {
        expect(isHostIntercepted([], 'example.com')).toBe(false)
        expect(isHostIntercepted([''], 'example.com')).toBe(false)
        expect(isHostIntercepted(['   '], 'example.com')).toBe(false)
    })

    it('matches wildcard and exact positive patterns', () => {
        expect(isHostIntercepted(['*'], 'anything.com')).toBe(true)
        expect(isHostIntercepted(['example.com'], 'example.com')).toBe(true)
        expect(isHostIntercepted(['example.com'], 'other.com')).toBe(false)
        expect(isHostIntercepted(['*.alayanew.com'], 'api.alayanew.com')).toBe(true)
        expect(isHostIntercepted(['*.alayanew.com'], 'alayanew.com')).toBe(true)
        expect(isHostIntercepted(['*.alayanew.com'], 'alayanew.org')).toBe(false)
    })

    it('excludes hosts matching negative patterns starting with !', () => {
        const patterns = ['*', '!vcluster.*', '!*.internal']

        // Excluded by negative patterns
        expect(isHostIntercepted(patterns, 'vcluster.hd-04.alayanew.com')).toBe(false)
        expect(isHostIntercepted(patterns, 'vcluster.local')).toBe(false)
        expect(isHostIntercepted(patterns, 'db.internal')).toBe(false)
        expect(isHostIntercepted(patterns, 'api.internal')).toBe(false)

        // Included by * and not excluded
        expect(isHostIntercepted(patterns, 'api.alayanew.com')).toBe(true)
        expect(isHostIntercepted(patterns, 'google.com')).toBe(true)
    })

    it('negative pattern overrides specific positive pattern', () => {
        const patterns = ['*.alayanew.com', '!vcluster.*']
        expect(isHostIntercepted(patterns, 'api.alayanew.com')).toBe(true)
        expect(isHostIntercepted(patterns, 'vcluster.alayanew.com')).toBe(false)
    })

    it('handles whitespace around patterns and negative exclamation marks', () => {
        const patterns = ['  *  ', '  !*.dev.local  ']
        expect(isHostIntercepted(patterns, 'service.dev.local')).toBe(false)
        expect(isHostIntercepted(patterns, 'service.prod.local')).toBe(true)
    })

    it('ignores lone ! without host pattern', () => {
        expect(isHostIntercepted(['*', '!'], 'example.com')).toBe(true)
    })

    it('returns false when only negative patterns are provided', () => {
        expect(isHostIntercepted(['!bad.com'], 'good.com')).toBe(false)
    })
})
