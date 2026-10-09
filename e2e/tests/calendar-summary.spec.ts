import { expect, test, type Page } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test.use({ serviceWorkers: 'block' })

test('달력은 수입·지출을 작은 독립 행과 건수로 표시하고 반응형 선택을 유지한다', async ({ page, request }, testInfo) => {
  const evidence: unknown[] = []
  page.on('console', (message) => { if (message.type() === 'error') evidence.push({ console: message.text() }) })
  page.on('pageerror', (error) => evidence.push({ error: error.message }))
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) evidence.push({ path, status: response.status(), requestId: response.headers()['x-request-id'] })
  })
  try {
    const account = await registerAndLogin(page, request, `달력 UI ${testInfo.workerIndex}`)
    await page.getByRole('button', { name: '가계부 시작하기' }).click()
    await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()
    const days = [
      { date: '2026-10-01', incomeWon: 679_500, expenseWon: 22_000, netWon: 657_500, cardPaymentWon: 0, transactionCount: 3 },
      { date: '2026-10-04', incomeWon: 0, expenseWon: 222_304, netWon: -222_304, cardPaymentWon: 0, transactionCount: 2 },
      { date: '2026-10-05', incomeWon: 100_000, expenseWon: 0, netWon: 100_000, cardPaymentWon: 0, transactionCount: 1 },
      { date: '2026-10-07', incomeWon: 999_999, expenseWon: 999_999, netWon: 0, cardPaymentWon: 123_456, transactionCount: 5 },
      { date: '2026-10-08', incomeWon: 0, expenseWon: 0, netWon: 0, cardPaymentWon: 0, transactionCount: 2 },
      { date: '2026-10-09', incomeWon: 0, expenseWon: -4_000, netWon: 4_000, cardPaymentWon: 0, transactionCount: 1 },
      { date: '2026-10-10', incomeWon: 3_000_000, expenseWon: 2_000_000, netWon: 1_000_000, cardPaymentWon: 0, transactionCount: 4 },
    ]
    // 화면 경계용 fixture. 실제 집계·저장은 transactions.spec와 PostgreSQL 통합 테스트로 검증한다.
    await page.route('**/api/transactions/calendar?*', (route) => route.fulfill({ json: {
      month: '2026-10',
      totalIncomeWon: days.reduce((sum, day) => sum + day.incomeWon, 0),
      totalExpenseWon: days.reduce((sum, day) => sum + day.expenseWon, 0),
      netWon: days.reduce((sum, day) => sum + day.netWon, 0),
      days,
    } }))
    await testInfo.attach('seed-manifest', { body: JSON.stringify({ scenario: 'calendar-summary-v1', loginId: account.loginId, days }), contentType: 'application/json' })
    await page.goto('/?month=2026-10&date=2026-10-01')
    const calendar = page.getByRole('grid', { name: '2026년 10월 거래 달력' })
    const first = calendar.getByRole('gridcell', { name: /수입 \+679,500원, 지출 -22,000원, 합산 거래 3건/ })
    await expect(first.getByTitle('수입 +679,500원')).toHaveText('+679,500')
    await expect(first.getByTitle('지출 -22,000원')).toHaveText('-22,000')
    await expect(first.getByTitle('합산 거래 3건')).toHaveText('3건')
    await expect(calendar.getByRole('gridcell', { name: /^10월 8일.*합산 거래 2건/ })).not.toHaveAccessibleName(/거래 없음/)
    await expect(calendar.getByTitle('환불 +4,000원')).toHaveText('+4,000')
    await expect(calendar.getByTitle('수입 +3,000,000원')).toHaveText('+300만')
    await expect(first).toHaveCSS('border-right-width', '1px')
    await expect(calendar.getByRole('row').filter({ has: page.getByRole('gridcell', { name: /수입 \+679,500원, 지출 -22,000원, 합산 거래 3건/ }) })).toHaveCSS('border-top-width', '1px')

    for (const width of [320, 360, 375, 390, 430, 767, 768, 834, 1194, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(first).toHaveAttribute('aria-selected', 'true')
      const layout = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('body *')].map((element) => ({
          tag: element.tagName, role: element.getAttribute('role'), classes: element.getAttribute('class'),
          right: element.getBoundingClientRect().right,
        })).filter((element) => element.right > window.innerWidth + 1),
      }))
      await testInfo.attach(`layout-${width}`, { body: JSON.stringify(layout), contentType: 'application/json' })
      expect(layout.scrollWidth, `페이지 가로 넘침: ${width}px`).toBeLessThanOrEqual(layout.width)
      const positions = await first.locator('[title]').evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { y: box.y, bottom: box.bottom }
      }))
      expect(positions[0].bottom).toBeLessThanOrEqual(positions[1].y)
      expect(positions[1].bottom).toBeLessThanOrEqual(positions[2].y)
      const amountsFit = await calendar.locator('[title]').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1))
      expect(amountsFit, `금액·건수 overflow: ${width}px`).toBe(true)
      if (width <= 430 || width === 834 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`calendar-${width}.png`), fullPage: true })
      }
    }
    await expect(first.getByTitle('수입 +679,500원')).toHaveCSS('color', await tokenColor(page, '--calendar-income'))
    await expect(first.getByTitle('지출 -22,000원')).toHaveCSS('color', await tokenColor(page, '--calendar-expense'))
    await page.evaluate(() => localStorage.setItem('dondok-theme', 'dark'))
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(first.getByTitle('수입 +679,500원')).toHaveCSS('color', await tokenColor(page, '--calendar-income'))
    await expect(first.getByTitle('지출 -22,000원')).toHaveCSS('color', await tokenColor(page, '--calendar-expense'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('calendar-dark.png'), fullPage: true })
    await first.getByRole('button').click()
    await expect(page.getByRole('region', { name: '2026-10-01 거래 상세' })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('region', { name: '2026-10-01 거래 상세' })).toBeVisible()
    await page.getByRole('button', { name: '달력으로 돌아가기' }).click()
    await expect(first).toHaveAttribute('aria-selected', 'true')
  } finally {
    await testInfo.attach('console-network-request-ids', { body: JSON.stringify(evidence), contentType: 'application/json' })
  }
})

async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name)
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}
