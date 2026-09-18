import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../shared/model'

vi.mock('vscode', () => import('./vscodeMock'))
const mock = await import('./vscodeMock')
const { TrafficView } = await import('../views/trafficView')

const make = (sequence: number, url: string, extra: Partial<Transaction> = {}): Transaction => {
    const u = new URL(url)
    return {
        id: `t${sequence}`,
        sequence,
        timestamp: 0,
        method: 'GET',
        url,
        host: u.hostname,
        path: u.pathname + u.search,
        scheme: u.protocol.replace(':', ''),
        client: '127.0.0.1:1',
        state: 'completed',
        status: 200,
        requestHeaders: {},
        responseHeaders: {},
        requestBody: '',
        responseBody: '',
        requestBinary: false,
        responseBinary: false,
        requestBytes: 0,
        responseBytes: 10,
        truncated: false,
        duration: 5,
        tls: u.protocol === 'https:',
        frames: [],
        ...extra
    }
}

function client(items: Transaction[]) {
    const events = new mock.EventEmitter<unknown>()
    return {
        transactions: new Map(items.map((t) => [t.id, t])),
        onEvent: events.event,
        running: true,
        port: 6070
    } as any
}

describe('TrafficView structure mode', () => {
    const items = [
        make(1, 'https://api.example.com/v1/users?page=1'),
        make(2, 'https://api.example.com/v1/users/42'),
        make(3, 'https://api.example.com/health'),
        make(4, 'http://static.example.com/'),
        make(5, 'https://api.example.com/v1/users?page=2')
    ]

    it('lists hosts, then path folders, then requests like Charles', () => {
        const view = new TrafficView(client(items))
        const hosts = view.getChildren()
        expect(hosts).toEqual([
            { kind: 'host', host: 'api.example.com' },
            { kind: 'host', host: 'static.example.com' }
        ])
        const api = view.getChildren(hosts[0])
        expect(api).toEqual([
            { kind: 'folder', host: 'api.example.com', prefix: 'health' },
            { kind: 'folder', host: 'api.example.com', prefix: 'v1' }
        ])
        // `health` is a leaf path: the folder holds the single request.
        expect(view.getChildren(api[0])).toEqual([{ kind: 'transaction', id: 't3' }])
        const v1 = view.getChildren(api[1])
        expect(v1).toEqual([{ kind: 'folder', host: 'api.example.com', prefix: 'v1/users' }])
        const users = view.getChildren(v1[0])
        expect(users).toEqual([
            { kind: 'folder', host: 'api.example.com', prefix: 'v1/users/42' },
            { kind: 'transaction', id: 't1' },
            { kind: 'transaction', id: 't5' }
        ])
        // Root requests hang directly off the host.
        expect(view.getChildren(hosts[1])).toEqual([{ kind: 'transaction', id: 't4' }])
    })

    it('renders labels, counts and click commands', () => {
        const view = new TrafficView(client(items))
        const host = view.getTreeItem({ kind: 'host', host: 'api.example.com' })
        expect(host.label).toBe('api.example.com')
        expect(host.description).toBe('4')
        expect((host.command as any).command).toBe('tapline.openHost')
        const leaf = view.getTreeItem({ kind: 'transaction', id: 't1' })
        expect(leaf.label).toBe('users?page=1')
        expect(leaf.description).toContain('GET · 200')
        expect((leaf.command as any).command).toBe('tapline.open')
        expect(
            view.getTreeItem({ kind: 'folder', host: 'api.example.com', prefix: 'v1/users' }).label
        ).toBe('users')
    })

    it('resolves parents so reveal() can walk up the tree', () => {
        const view = new TrafficView(client(items))
        expect(view.getParent({ kind: 'transaction', id: 't2' })).toEqual({
            kind: 'folder',
            host: 'api.example.com',
            prefix: 'v1/users/42'
        })
        expect(
            view.getParent({ kind: 'folder', host: 'api.example.com', prefix: 'v1/users' })
        ).toEqual({ kind: 'folder', host: 'api.example.com', prefix: 'v1' })
        expect(view.getParent({ kind: 'folder', host: 'api.example.com', prefix: 'v1' })).toEqual({
            kind: 'host',
            host: 'api.example.com'
        })
        expect(view.getParent({ kind: 'transaction', id: 't4' })).toEqual({
            kind: 'host',
            host: 'static.example.com'
        })
    })

    it('selects every request under a folder or host for bulk actions', () => {
        const view = new TrafficView(client(items))
        expect(
            view
                .selected({ kind: 'folder', host: 'api.example.com', prefix: 'v1/users' })
                .map((t) => t.id)
                .sort()
        ).toEqual(['t1', 't2', 't5'])
        expect(view.selected({ kind: 'host', host: 'api.example.com' })).toHaveLength(4)
    })
})
