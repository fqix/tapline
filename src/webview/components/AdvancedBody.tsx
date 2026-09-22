import { useEffect, useRef } from 'react'
import {
    encodeBase64,
    graphqlBody,
    multipartBody,
    type BodyDraft,
    type UploadPart
} from '../lib/body'
import { t } from '../lib/i18n'
import { IconButton } from './IconButton'

export interface BodyUpdate {
    body: string
    bodyEncoding?: 'base64'
    bodyDraft: BodyDraft
    bodyError?: string
}

export function AdvancedBody({
    draft,
    onChange
}: {
    draft: BodyDraft
    onChange(value: BodyUpdate, contentType?: string): void
}) {
    const generation = useRef(0)
    const latestOnChange = useRef(onChange)
    latestOnChange.current = onChange
    useEffect(
        () => () => {
            generation.current++
        },
        []
    )
    const parts = draft.parts ?? []
    const updateParts = (next: UploadPart[]) => {
        generation.current++
        const bodyDraft = { ...draft, parts: next }
        const boundary = `----Tapline${crypto.randomUUID().replace(/-/g, '')}`
        try {
            latestOnChange.current(
                { body: multipartBody(next, boundary), bodyEncoding: 'base64', bodyDraft },
                `multipart/form-data; boundary=${boundary}`
            )
        } catch (error) {
            latestOnChange.current({ body: '', bodyDraft, bodyError: String(error) })
        }
    }
    const updateGraphQL = (patch: Partial<BodyDraft>) => {
        const bodyDraft = { ...draft, ...patch }
        try {
            latestOnChange.current(
                {
                    body: graphqlBody(
                        bodyDraft.query ?? '',
                        bodyDraft.variables ?? '',
                        bodyDraft.operationName ?? ''
                    ),
                    bodyDraft
                },
                'application/json'
            )
        } catch (error) {
            latestOnChange.current({ body: '', bodyDraft, bodyError: String(error) })
        }
    }
    const pick = async (file: File | undefined, index?: number) => {
        if (!file) return
        const version = ++generation.current
        latestOnChange.current({ body: '', bodyDraft: draft, bodyError: t('readingFile') })
        try {
            const base64 = encodeBase64(new Uint8Array(await file.arrayBuffer()))
            if (version !== generation.current) return
            if (index === undefined)
                latestOnChange.current(
                    {
                        body: base64,
                        bodyEncoding: 'base64',
                        bodyDraft: { ...draft, fileName: file.name }
                    },
                    file.type || 'application/octet-stream'
                )
            else
                updateParts(
                    parts.map((part, i) =>
                        i === index
                            ? { ...part, base64, filename: file.name, contentType: file.type }
                            : part
                    )
                )
        } catch (error) {
            if (version === generation.current)
                latestOnChange.current({ body: '', bodyDraft: draft, bodyError: String(error) })
        }
    }
    if (draft.mode === 'binary')
        return (
            <div className="binary-body">
                <label>
                    {t('chooseBodyFile')}
                    <input
                        type="file"
                        onChange={(e) => {
                            void pick(e.target.files?.[0])
                            e.target.value = ''
                        }}
                    />
                </label>
                {draft.fileName && <span className="muted">{draft.fileName}</span>}
            </div>
        )
    if (draft.mode === 'GraphQL')
        return (
            <div className="graphql-body">
                <label>
                    Query
                    <textarea
                        className="mono"
                        rows={8}
                        spellCheck={false}
                        value={draft.query ?? ''}
                        onChange={(e) => updateGraphQL({ query: e.target.value })}
                        placeholder={'query {\n  viewer { id }\n}'}
                    />
                </label>
                <label>
                    Variables
                    <textarea
                        className="mono"
                        rows={4}
                        spellCheck={false}
                        value={draft.variables ?? ''}
                        onChange={(e) => updateGraphQL({ variables: e.target.value })}
                        placeholder="{}"
                    />
                </label>
                <label>
                    Operation Name
                    <input
                        type="text"
                        value={draft.operationName ?? ''}
                        onChange={(e) => updateGraphQL({ operationName: e.target.value })}
                    />
                </label>
            </div>
        )
    const patch = (index: number, patch: Partial<UploadPart>) =>
        updateParts(parts.map((part, i) => (i === index ? { ...part, ...patch } : part)))
    return (
        <div className="multipart-body">
            <div className="multipart-row muted">
                <span />
                <span>{t('key')}</span>
                <span>{t('bodyFieldType')}</span>
                <span>{t('value')}</span>
                <span />
            </div>
            {parts.map((part, index) => (
                <div className="multipart-row" key={index}>
                    <input
                        type="checkbox"
                        aria-label={`${t('enableField')} ${index + 1}`}
                        checked={part.enabled}
                        onChange={(e) => patch(index, { enabled: e.target.checked })}
                    />
                    <input
                        type="text"
                        aria-label={`${t('key')} ${index + 1}`}
                        placeholder={t('key')}
                        value={part.name}
                        onChange={(e) => patch(index, { name: e.target.value })}
                    />
                    <select
                        aria-label={`${t('bodyFieldType')} ${index + 1}`}
                        value={part.type}
                        onChange={(e) => patch(index, { type: e.target.value as 'text' | 'file' })}
                    >
                        <option value="text">Text</option>
                        <option value="file">File</option>
                    </select>
                    {part.type === 'text' ? (
                        <input
                            type="text"
                            aria-label={`${t('value')} ${index + 1}`}
                            value={part.value}
                            onChange={(e) => patch(index, { value: e.target.value })}
                        />
                    ) : (
                        <label className="multipart-file">
                            <input
                                type="file"
                                aria-label={`${t('chooseBodyFile')} ${index + 1}`}
                                onChange={(e) => {
                                    void pick(e.target.files?.[0], index)
                                    e.target.value = ''
                                }}
                            />
                            <span className="muted">{part.filename}</span>
                        </label>
                    )}
                    <IconButton
                        icon="close"
                        title={t('remove')}
                        onClick={() => updateParts(parts.filter((_, i) => i !== index))}
                    />
                </div>
            ))}
            <button
                type="button"
                className="button secondary"
                onClick={() =>
                    updateParts([...parts, { name: '', value: '', enabled: true, type: 'text' }])
                }
            >
                {t('addBodyField')}
            </button>
        </div>
    )
}
