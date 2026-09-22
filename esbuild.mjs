import { build, context } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const watch = process.argv.includes('--watch')
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// curlconverter parses bash with a native tree-sitter addon; the extension host cannot
// load that, so its parser module is swapped for our WebAssembly-backed one and the two
// .wasm files travel next to the bundle.
const wasmParser = {
    name: 'curlconverter-wasm-parser',
    setup(build) {
        build.onResolve({ filter: /(^\.\/|\/)Parser\.js$/ }, (args) =>
            args.importer.includes('curlconverter')
                ? { path: fileURLToPath(new URL('./src/utils/curlParser.ts', import.meta.url)) }
                : undefined
        )
    }
}
mkdirSync('dist', { recursive: true })
for (const [from, to] of [
    ['node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/tree-sitter.wasm'],
    ['node_modules/curlconverter/dist/tree-sitter-bash.wasm', 'dist/tree-sitter-bash.wasm']
])
    copyFileSync(from, to)

const node = {
    entryPoints: { extension: 'src/extension.ts', agent: 'src/agent/main.ts' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outdir: 'dist',
    external: ['vscode'],
    plugins: [wasmParser],
    define: { 'process.env.TAPLINE_VERSION': JSON.stringify(version) },
    sourcemap: true,
    minify: !watch,
    logLevel: 'info'
}
const web = {
    entryPoints: { webview: 'src/webview/main.tsx' },
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outdir: 'dist',
    // codicon.css references codicon.ttf; emit it next to webview.css under its own name.
    loader: { '.ttf': 'file' },
    assetNames: '[name]',
    sourcemap: true,
    minify: !watch,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' }
}
if (watch)
    await Promise.all([context(node).then((c) => c.watch()), context(web).then((c) => c.watch())])
else await Promise.all([build(node), build(web)])
