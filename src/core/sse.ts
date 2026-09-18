import { StringDecoder } from 'node:string_decoder'

export interface ParsedEvent {
    event: string
    data: string
    lastEventId: string
    retry?: number
}

/** Incremental UTF-8 event-stream parser. EOF never dispatches an unfinished event. */
export class SSEParser {
    private decoder = new StringDecoder('utf8')
    private first = true
    private skipLF = false
    private line = ''
    private lineLength = 0
    private size = 0
    private dropped = false
    private data: string[] = []
    private event = ''
    private lastEventId = ''
    private retry?: number

    constructor(
        private limit: number,
        private emit: (event: ParsedEvent) => void,
        private truncate: () => void
    ) {}

    push(chunk: Buffer) {
        for (const char of this.decoder.write(chunk)) {
            if (this.first) {
                this.first = false
                if (char === '\uFEFF') continue
            }
            if (this.skipLF) {
                this.skipLF = false
                if (char === '\n') continue
            }
            if (char === '\r' || char === '\n') {
                this.consumeLine()
                this.skipLF = char === '\r'
                continue
            }
            this.lineLength++
            this.size += Buffer.byteLength(char)
            if (this.size > this.limit && !this.dropped) {
                this.dropped = true
                this.line = ''
                this.data = []
                this.event = ''
                this.truncate()
            }
            if (!this.dropped) this.line += char
        }
    }

    private consumeLine() {
        if (this.lineLength === 0) {
            if (!this.dropped && this.data.length)
                this.emit({
                    event: this.event || 'message',
                    data: this.data.join('\n'),
                    lastEventId: this.lastEventId,
                    retry: this.retry
                })
            this.data = []
            this.event = ''
            this.size = 0
            this.dropped = false
        } else if (!this.dropped && !this.line.startsWith(':')) {
            const colon = this.line.indexOf(':')
            const name = colon < 0 ? this.line : this.line.slice(0, colon)
            let value = colon < 0 ? '' : this.line.slice(colon + 1)
            if (value.startsWith(' ')) value = value.slice(1)
            if (name === 'data') this.data.push(value)
            else if (name === 'event') this.event = value
            else if (name === 'id' && !value.includes('\0')) this.lastEventId = value
            else if (name === 'retry' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
                this.retry = Number(value)
        }
        this.line = ''
        this.lineLength = 0
    }
}
