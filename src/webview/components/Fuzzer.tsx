import { useMemo, useState } from 'react'
import { hasFuzzMarker } from '../../shared/model'
import { fuzzMarkerLocations } from '../lib/fuzzMarkers'
import { t } from '../lib/i18n'
import { vscode } from '../lib/vscode'
import type { ComposeDraft, FuzzDraft, FuzzFile, FuzzResult } from '../types/messages'
import { composeRequest, validComposeUrl } from './Composer'
import { textToHeaders } from './Editor'
import { StatusBadge } from './StatusBadge'

export const emptyFuzzDraft = (): FuzzDraft => ({ files: [] })

export interface FuzzStatus {
    running: boolean
    done: number
    total: number
    results: FuzzResult[]
    error?: string
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path

/** Fuzz settings for the request being edited in (Re)Play: wordlists and progress. */
export function FuzzConfig({
    request,
    draft,
    onChange,
    files,
    status,
    onPickFiles
}: {
    request: ComposeDraft
    draft: FuzzDraft
    onChange(next: FuzzDraft): void
    files: FuzzFile[]
    status: FuzzStatus
    onPickFiles(): void
}) {
    const [error, setError] = useState<string>()
    // Every $FUZZ$ in the request is filled from the same payload; no target picking.
    const marked = useMemo(
        () =>
            hasFuzzMarker({
                url: request.url,
                headers: textToHeaders(request.headers),
                body: request.body
            }),
        [request.url, request.headers, request.body]
    )
    const locations = useMemo(() => fuzzMarkerLocations(request), [request])
    const toggleFile = (path: string) =>
        onChange({
            ...draft,
            files: draft.files.includes(path)
                ? draft.files.filter((f) => f !== path)
                : [...draft.files, path]
        })
    const start = () => {
        setError(undefined)
        if (!validComposeUrl(request.url)) return setError(t('fuzzInvalidUrl'))
        if (request.bodyError) return setError(request.bodyError)
        if (!draft.files.length || !marked) return setError(t('fuzzMissing'))
        vscode.postMessage({
            type: 'startFuzz',
            start: {
                request: composeRequest(request),
                files: draft.files,
                targets: [{ kind: 'marker' }]
            }
        })
    }
    return (
        <div className="fuzz-config">
            <section>
                <h4 className="fuzz-head">{t('fuzzMarkers')}</h4>
                {locations.length ? (
                    <table className="fuzz-markers">
                        <thead>
                            <tr>
                                <th>{t('fuzzLocation')}</th>
                                <th>{t('fuzzElement')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {locations.map((row, index) => (
                                <tr key={index}>
                                    <td>{row.location}</td>
                                    <td className="mono ellipsis">{row.element}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <p className="muted fuzz-note">{t('fuzzNoMarkers')}</p>
                )}
            </section>
            <section>
                <h4 className="fuzz-head">
                    {t('fuzzWordlists')}
                    <button type="button" className="button secondary" onClick={onPickFiles}>
                        {t('fuzzAddFiles')}
                    </button>
                </h4>
                {files.length ? (
                    <div className="fuzz-list">
                        {files.map((file) => (
                            <label key={file.path} className="fuzz-item" title={file.path}>
                                <input
                                    type="checkbox"
                                    checked={draft.files.includes(file.path)}
                                    onChange={() => toggleFile(file.path)}
                                />
                                <span className="ellipsis">{nameOf(file.path)}</span>
                                <span className="muted num">
                                    {file.error ?? `${file.lines} ${t('fuzzLines')}`}
                                </span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <p className="muted fuzz-note">{t('fuzzNoFiles')}</p>
                )}
            </section>
            <section>
                <h4 className="fuzz-head">
                    {t('fuzzResults')}
                    <span className="muted">
                        {status.total ? t('fuzzProgress', status.done, status.total) : ''}
                    </span>
                    {status.running && (
                        <button
                            type="button"
                            className="button secondary"
                            onClick={() => vscode.postMessage({ type: 'stopFuzz' })}
                        >
                            {t('fuzzStop')}
                        </button>
                    )}
                    <button type="button" className="button" onClick={start}>
                        <span className="codicon codicon-run-all" aria-hidden="true" />
                        {t('fuzzStart')}
                    </button>
                </h4>
                {status.total > 0 && (
                    <div className="fuzz-bar">
                        <div style={{ width: `${(status.done / status.total) * 100}%` }} />
                    </div>
                )}
                {status.results.length ? (
                    <div className="fuzz-list">
                        {status.results
                            .slice()
                            .reverse()
                            .map((result, i) => (
                                <div key={i} className="fuzz-item">
                                    <StatusBadge
                                        x={{
                                            status: result.status,
                                            state: result.error ? 'error' : 'completed',
                                            scheme: 'http'
                                        }}
                                    />
                                    <span
                                        className="mono ellipsis"
                                        title={`${result.target}: ${result.payload}`}
                                    >
                                        {result.payload || '(empty)'}
                                    </span>
                                    <span className="muted ellipsis">{result.target}</span>
                                </div>
                            ))}
                    </div>
                ) : (
                    <p className="muted fuzz-note">{t('fuzzNoResults')}</p>
                )}
            </section>
            {(error || status.error) && <p className="note error">{error ?? status.error}</p>}
        </div>
    )
}
