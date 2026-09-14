import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

// The fit tests compare in-page measurement with Chromium's own PDF
// pagination, so they run on Chromium only.
export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A sandbox without the matching Playwright download can point
        // this at any Chromium binary.
        launchOptions: process.env.FLASHPRINT_CHROMIUM
          ? { executablePath: process.env.FLASHPRINT_CHROMIUM }
          : {},
      },
    },
  ],
  webServer: {
    command: 'pnpm run build && pnpm run preview',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
