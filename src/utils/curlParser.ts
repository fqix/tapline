// Replaces curlconverter's `shell/Parser.js` (native tree-sitter) in our bundles with the
// WebAssembly build, which runs in the extension host without native addons. The build
// and the test runner both route curlconverter's import here.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Parser from 'web-tree-sitter'

/** The two .wasm files ship next to the bundle; in tests they come from node_modules. */
function locate(name: string): string {
    const here = typeof __dirname === 'string' ? __dirname : process.cwd()
    const candidates = [
        join(here, name),
        join(process.cwd(), 'node_modules', 'web-tree-sitter', name),
        join(process.cwd(), 'node_modules', 'curlconverter', 'dist', name)
    ]
    return candidates.find((c) => existsSync(c)) ?? candidates[0]
}

let parser: Parser | undefined
/** Resolves once the bash grammar is loaded; parsing before that throws. */
export const ready: Promise<void> = (async () => {
    await Parser.init({ locateFile: (name: string) => locate(name) })
    const bash = await Parser.Language.load(locate('tree-sitter-bash.wasm'))
    const p = new Parser()
    p.setLanguage(bash)
    parser = p
})()

export default {
    parse(...args: Parameters<Parser['parse']>) {
        if (!parser) throw new Error('curl parser is still loading')
        return parser.parse(...args)
    }
}
