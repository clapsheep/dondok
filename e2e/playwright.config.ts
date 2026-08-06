import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['blob'], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chrome', testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'ipad-portrait', testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['iPad Pro 11'] } },
    { name: 'desktop-chrome', testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', testMatch: /.*\.webkit\.spec\.ts/, use: { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' } },
  ],
  outputDir: 'test-results',
})
