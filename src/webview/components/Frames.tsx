import { useMemo } from 'react'
import { bytes, type Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { eventSearchText, frameSize, resendUnavailable } from '../lib/messages'
import { MessageStream } from './MessageStream'

const clock = (time: number) => new Date(time).toISOString().slice(11, 23)

export function Frames({ x }: { x: Transaction }) {
    const open = x.state === 'pending' && x.status === 101
    const items = useMemo(
        () =>
            x.frames.map((f) => ({
                id: f.id,
                text: f.data,
                search: f.data,
                direction: f.direction,
                binary: f.binary,
                resendDisabled: resendUnavailable(f, open),
                body: (
                    <div className={`frame ${f.direction}`}>
                        <span
                            className={`codicon codicon-arrow-${f.direction === 'send' ? 'up' : 'down'} dir`}
                            title={t(f.direction === 'send' ? 'streamSent' : 'streamReceived')}
                        />
                        <time className="time" dateTime={new Date(f.time).toISOString()}>
                            {clock(f.time)}
                        </time>
                        <div className="frame-content">
                            <div className="event-meta muted">
                                <span>{bytes(frameSize(f))}</span>
                                {f.binary && <span>Base64</span>}
                                {f.truncated && <span>{t('streamTruncated')}</span>}
                                {f.replayOf && <span>{t('streamResent')}</span>}
                            </div>
                            <pre>{f.data}</pre>
                        </div>
                    </div>
                )
            })),
        [x.frames, open]
    )
    return (
        <MessageStream
            items={items}
            className="frames"
            transaction={x.id}
            open={open}
            empty={open ? 'streamWaiting' : 'streamEmpty'}
            notice={x.framesTruncated && <p className="note">{t('streamFramesTruncated')}</p>}
        />
    )
}

export function ServerEvents({ x }: { x: Transaction }) {
    const items = useMemo(
        () =>
            (x.events ?? []).map((event) => ({
                id: event.id,
                text: event.data,
                search: eventSearchText(event),
                body: (
                    <div className="frame receive">
                        <span className="codicon codicon-arrow-down dir" aria-hidden="true" />
                        <time className="time" dateTime={new Date(event.time).toISOString()}>
                            {clock(event.time)}
                        </time>
                        <div className="frame-content">
                            <div className="event-meta">
                                <strong>{event.event}</strong>
                                {event.lastEventId && <span>id: {event.lastEventId}</span>}
                                {event.retry !== undefined && <span>retry: {event.retry} ms</span>}
                            </div>
                            <pre>{event.data}</pre>
                        </div>
                    </div>
                )
            })),
        [x.events]
    )
    return (
        <MessageStream
            items={items}
            className="frames server-events"
            empty={x.state === 'pending' ? 'eventsWaiting' : 'eventsEmpty'}
            notice={x.eventsTruncated && <p className="note">{t('eventsTruncated')}</p>}
        />
    )
}
