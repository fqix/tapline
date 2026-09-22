import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Same swap as esbuild.mjs: curlconverter's native bash parser → the wasm one. */
const wasmParser = {
    name: 'curlconverter-wasm-parser',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
        return /(^\.\/|\/)Parser\.js$/.test(source) && importer?.includes('curlconverter')
            ? fileURLToPath(new URL('./src/utils/curlParser.ts', import.meta.url))
            : null
    }
}

export default defineConfig({
    plugins: [wasmParser],
    test: {
        // Externalized dependencies bypass resolveId and load the native parser.
        server: { deps: { inline: ['curlconverter'] } },
        include: ['src/test/**/*.test.ts', 'src/webview/**/*.test.ts'],
        testTimeout: 30000
    }
})
