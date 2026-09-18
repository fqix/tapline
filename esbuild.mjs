import { build, context } from 'esbuild'
const watch = process.argv.includes('--watch')
const options = {
    entryPoints: { extension: 'src/extension/extension.ts', agent: 'src/agent/main.ts' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outdir: 'dist',
    external: ['vscode'],
    sourcemap: true,
    minify: !watch,
    logLevel: 'info'
}
if (watch) await (await context(options)).watch()
else await build(options)
