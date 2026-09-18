import type { Transaction } from '../../shared/model'
import { t } from '../lib/i18n'

export function Frames({ x }: { x: Transaction }) {
    return (
        <section className="frames">
            {x.frames.map((f) => (
                <div key={f.id} className={`frame ${f.direction}`}>
                    <span className="dir">{f.direction === 'send' ? '↑' : '↓'}</span>
                    <span className="time mono">
                        {new Date(f.time).toISOString().slice(11, 23)}
                    </span>
                    <pre className="mono">
                        {f.binary ? t('binary', Math.floor((f.data.length * 3) / 4)) : f.data}
                    </pre>
                </div>
            ))}
        </section>
    )
}
