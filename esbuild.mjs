import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'
const watch = process.argv.includes('--watch')
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const node = {
    entryPoints: { extension: 'src/extension.ts', agent: 'src/agent/main.ts' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outdir: 'dist',
    external: ['vscode'],
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
