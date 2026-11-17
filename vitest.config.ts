import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
  },
})
