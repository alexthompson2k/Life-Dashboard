import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'server/**/*.js'],
      exclude: ['src/lib/demoData.ts', 'src/lib/**/*.test.ts'],
    },
  },
})
