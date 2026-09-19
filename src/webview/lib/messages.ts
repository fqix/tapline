import type { Frame, GrpcMessage, ServerEvent } from '../../shared/model'

export type MessageDirection = 'all' | 'send' | 'receive'

/** Literal, case-insensitive search; wire data is never treated as a regular expression. */
export function matchesMessage(text: string, query: string) {
    return text.toLowerCase().includes(query.trim().toLowerCase())
}

export function frameSize(frame: Frame) {
    if (frame.size !== undefined) return frame.size
    if (!frame.binary) return new TextEncoder().encode(frame.data).length
    return (
        Math.floor((frame.data.length * 3) / 4) -
        (frame.data.endsWith('==') ? 2 : frame.data.endsWith('=') ? 1 : 0)
    )
}

export const eventSearchText = (event: ServerEvent) =>
    [event.event, event.lastEventId, event.retry ?? '', event.data].join('\n')

export const grpcText = (message: GrpcMessage) =>
    message.body !== undefined ? JSON.stringify(message.body, null, 2) : (message.error ?? '')

export function resendUnavailable(frame: Frame, open: boolean) {
    if (!open) return 'streamClosed'
    if (frame.direction !== 'send') return 'streamReceiveOnly'
    if (frame.truncated) return 'streamTruncatedResend'
    return undefined
}
