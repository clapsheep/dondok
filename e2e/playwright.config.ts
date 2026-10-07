import { defineConfig, devices } from '@playwright/test'

const scope = process.env.E2E_SCOPE ?? 'full'
if (!['full', 'pr', 'benchmark'].includes(scope)) throw new Error('Invalid E2E_SCOPE')
const workers = Number(process.env.E2E_WORKERS ?? '2')
if (!Number.isInteger(workers) || workers < 1 || workers > 3) throw new Error('E2E_WORKERS must be 1, 2 or 3')
const affected = process.env.E2E_AFFECTED_PATTERN ?? '.*'
const selected = (core = false) => scope === 'pr' ? new RegExp(core ? `@pr|${affected}` : affected) : undefined

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: scope === 'benchmark' ? 0 : process.env.CI ? 2 : 0,
  workers: process.env.CI ? workers : undefined,
  reporter: process.env.CI ? [['blob'], ['github'], ['json', { outputFile: 'test-results/results.json' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chrome', grep: selected(), testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'ipad-portrait', grep: selected(), testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['iPad Pro 11'] } },
    { name: 'desktop-chrome', grep: selected(true), testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', grep: selected(), testMatch: /.*\.webkit\.spec\.ts/, use: { ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' } },
  ],
  outputDir: 'test-results',
})
