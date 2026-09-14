import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'flashprint',
    include: ['src/**/*.spec.ts'],
    environment: 'jsdom',
  },
})
