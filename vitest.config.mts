import { defineConfig } from 'vitest/config'
export default defineConfig({
    test: { include: ['src/test/**/*.test.ts'], testTimeout: 30000 }
})
