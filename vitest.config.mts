import { defineConfig } from 'vitest/config'
export default defineConfig({
    test: { include: ['src/test/**/*.test.ts', 'src/webview/**/*.test.ts'], testTimeout: 30000 }
})
