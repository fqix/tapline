import type { Transaction } from '../../shared/model'
import { t } from '../lib/i18n'
import { MessagePane } from './MessagePane'
import { SplitPane } from './SplitPane'

/** Charles "Contents": request on top, response below, each with its own sub-tabs. */
export function ContentsView({ x }: { x: Transaction }) {
    if (x.scheme === 'connect') return <p className="note">{t('tunnel')}</p>
    return (
        <SplitPane
            top={<MessagePane x={x} side="request" />}
            bottom={<MessagePane x={x} side="response" />}
            initial={0.45}
        />
    )
}
