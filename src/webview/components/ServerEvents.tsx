import type { Transaction } from '../../shared/model'
import { t } from '../lib/i18n'

export function ServerEvents({ x }: { x: Transaction }) {
    return (
        <section className="frames server-events">
            {x.eventsTruncated && <p className="note">{t('eventsTruncated')}</p>}
            {!x.events?.length && (
                <p className="note">{t(x.state === 'pending' ? 'eventsWaiting' : 'eventsEmpty')}</p>
            )}
            {x.events?.map((event) => (
                <div key={event.id} className="frame receive">
                    <span className="dir">↓</span>
                    <time className="mono" dateTime={new Date(event.time).toISOString()}>
                        {new Date(event.time).toISOString().slice(11, 23)}
                    </time>
                    <div>
                        <div className="event-meta mono">
                            <strong>{event.event}</strong>
                            {event.lastEventId && <span>ID: {event.lastEventId}</span>}
                            {event.retry !== undefined && <span>retry: {event.retry} ms</span>}
                        </div>
                        <pre className="mono">{event.data}</pre>
                    </div>
                </div>
            ))}
        </section>
    )
}
