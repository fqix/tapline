import { useMemo } from 'react'
import { bytes, type GrpcInfo, type GrpcMessage } from '../../shared/model'
import { t } from '../lib/i18n'
import { tokenize } from '../lib/jsonHighlight'
import { grpcText } from '../lib/messages'
import { MessageStream } from './MessageStream'

function Body({ message }: { message: GrpcMessage }) {
    const text = useMemo(() => JSON.stringify(message.body ?? null, null, 2), [message.body])
    const tokens = useMemo(() => (text.length <= 256 * 1024 ? tokenize(text) : undefined), [text])
    return (
        <pre className="body">
            {tokens
                ? tokens.map((token, i) =>
                      token.kind === 'space' || token.kind === 'punct' ? (
                          token.text
                      ) : (
                          <span key={i} className={`tk-${token.kind}`}>
                              {token.text}
                          </span>
                      )
                  )
                : text}
        </pre>
    )
}

/** Decoded gRPC messages of one side, one card per length-prefixed frame. */
export function GrpcMessages({
    info,
    side,
    encoding
}: {
    info: GrpcInfo
    side: 'request' | 'response'
    encoding?: string
}) {
    const messages = info[side]
    const type = side === 'request' ? info.requestType : info.responseType
    const schemaless = messages.some((m) => m.body !== undefined && !m.type && !m.error)
    const items = useMemo(
        () =>
            messages.map((message) => ({
                id: String(message.index),
                text: grpcText(message),
                search: [
                    message.index,
                    message.type ?? type,
                    message.error,
                    grpcText(message)
                ].join('\n'),
                body: (
                    <section className="grpc-message">
                        <header className="grpc-message-head muted">
                            <span>#{message.index}</span>
                            <span>{bytes(message.size)}</span>
                            {message.compressed && <span>{encoding ?? t('compressed')}</span>}
                            {(message.type ?? type) && (
                                <span className="ellipsis" title={message.type ?? type}>
                                    {message.type ?? type}
                                </span>
                            )}
                        </header>
                        {message.error && <p className="note error">{message.error}</p>}
                        {message.body !== undefined ? (
                            <Body message={message} />
                        ) : (
                            !message.error && <p className="muted">{t('grpcUndecodable')}</p>
                        )}
                    </section>
                )
            })),
        [messages, type, encoding]
    )
    return (
        <MessageStream
            items={items}
            className="grpc-messages"
            empty="noBody"
            notice={schemaless && <p className="note">{t('grpcNoSchema')}</p>}
        />
    )
}
