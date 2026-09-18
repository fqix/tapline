import type { Transaction } from '../../shared/model'
import { t } from '../lib/i18n'

const clock = (time: number) => new Date(time).toISOString().slice(11, 23)

export function Frames({ x }: { x: Transaction }) {
    return (
        <div className="frames">
            {x.frames.map((f) => (
                <div key={f.id} className={`frame ${f.direction}`}>
                    <span
                        className={`codicon codicon-arrow-${f.direction === 'send' ? 'up' : 'down'} dir`}
                        aria-hidden="true"
                    />
                    <span className="time mono">{clock(f.time)}</span>
                    <pre className="mono">
                        {f.binary ? t('binary', Math.floor((f.data.length * 3) / 4)) : f.data}
                    </pre>
                </div>
            ))}
        </div>
    )
}

export function ServerEvents({ x }: { x: Transaction }) {
    return (
        <div className="frames server-events">
            {x.eventsTruncated && <p className="note">{t('eventsTruncated')}</p>}
            {!x.events?.length && (
                <p className="muted padded">
                    {t(x.state === 'pending' ? 'eventsWaiting' : 'eventsEmpty')}
                </p>
            )}
            {x.events?.map((event) => (
                <div key={event.id} className="frame receive">
                    <span className="codicon codicon-arrow-down dir" aria-hidden="true" />
                    <time className="time mono" dateTime={new Date(event.time).toISOString()}>
                        {clock(event.time)}
                    </time>
                    <div>
                        <div className="event-meta mono">
                            <strong>{event.event}</strong>
                            {event.lastEventId && <span>id: {event.lastEventId}</span>}
                            {event.retry !== undefined && <span>retry: {event.retry} ms</span>}
                        </div>
                        <pre className="mono">{event.data}</pre>
                    </div>
                </div>
            ))}
        </div>
    )
}
