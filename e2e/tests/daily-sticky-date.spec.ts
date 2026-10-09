import { expect, test, type Locator, type Page } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test.use({ serviceWorkers: 'block' })

test('일별 날짜는 양방향 스크롤에서 다음 날짜에 밀려 자연스럽게 교체된다', async ({ page, request }, testInfo) => {
  const evidence: unknown[] = []
  page.on('pageerror', (error) => evidence.push({ error: error.message }))
  page.on('console', (message) => { if (message.type() === 'error') evidence.push({ console: message.text() }) })
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) evidence.push({ path, status: response.status(), requestId: response.headers()['x-request-id'] })
  })
  try {
    await registerAndLogin(page, request, '날짜 스크롤 확인')
    await page.getByRole('button', { name: '가계부 시작하기' }).click()
    await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()
    const memberPicker = page.getByRole('radiogroup', { name: '표시할 구성원' })
    const everyone = memberPicker.getByRole('radio', { name: '모든 구성원 기록 보기' })
    const mine = memberPicker.getByRole('radio', { name: '내 기록 보기' })
    await memberPicker.getByText('모두', { exact: true }).click()
    const calendarPickerBox = await memberPicker.boundingBox()
    await page.getByRole('button', { name: '일별 보기', exact: true }).click()
    await expect(memberPicker).toBeVisible()
    await expect(everyone).toBeChecked()
    const dailyPickerBox = await memberPicker.boundingBox()
    expect(dailyPickerBox?.y).toBe(calendarPickerBox?.y)
    await memberPicker.getByText('나', { exact: true }).click()
    await page.getByRole('button', { name: '월간 달력', exact: true }).click()
    await expect(mine).toBeChecked()
    await page.getByRole('button', { name: '일별 보기', exact: true }).click()
    if (await page.getByRole('button', { name: '거래 필터', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: '거래 필터', exact: true }).click()
    const filterDialog = page.getByRole('group', { name: '거래 필터', exact: true })
    await filterDialog.getByLabel('구성원', { exact: true }).selectOption('')
    await expect(everyone).toBeChecked()
    await page.getByRole('button', { name: '월간 달력', exact: true }).click()
    await expect(everyone).toBeChecked()

    const dates = ['2026-10-11', '2026-10-10', '2026-10-09']
    const items = dates.flatMap((occurredOn, dayIndex) => Array.from({ length: 12 }, (_, index) => ({
      transactionId: `00000000-0000-4000-8000-${String(dayIndex * 12 + index).padStart(12, '0')}`,
      type: 'EXPENSE', managementType: 'GENERAL', transferSubtype: null, transferPurpose: null,
      relatedPurchaseTransactionId: null, cardPayment: null, occurredOn,
      amountWon: 1000, statisticsAmountWon: 1000,
      category: { categoryId: 'sample-category', name: '식비' },
      performedBy: null, createdBy: null, asset: null,
      description: `스크롤 확인 거래 ${index + 1}`, excludedFromStatistics: false,
      postings: [], installmentCount: null, version: 1,
      createdAt: `${occurredOn}T00:00:00Z`, updatedAt: `${occurredOn}T00:00:00Z`,
    })))
    await page.route('**/api/transactions?*', (route) => route.fulfill({ json: { items, nextCursor: null } }))
    const cardId = await page.evaluate(async () => {
      const assets = await (await fetch('/api/assets')).json() as Array<{ assetId: string; behavior: string }>
      return assets.find((asset) => asset.behavior === 'CREDIT_CARD')!.assetId
    })
    await page.route('**/api/assets/*/transactions?*', (route) => route.fulfill({ json: { items, nextCursor: null } }))
    await testInfo.attach('seed-manifest', { body: JSON.stringify({ dates, rowsPerDay: 12, dataSource: 'UI response fixture' }), contentType: 'application/json' })

    for (const path of ['/?view=daily&month=2026-10', `/assets/${cardId}`]) {
    const surface = path.startsWith('/assets') ? 'card' : 'daily'
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('dondok-theme', value), theme)
      await page.goto(path)
      await page.reload()
      const first = page.getByRole('region', { name: '2026년 10월 11일 일', exact: true })
      const next = page.getByRole('region', { name: '2026년 10월 10일 토', exact: true })
      const firstHeader = first.locator('header')
      const nextHeader = next.locator('header')
      await expect(first.getByRole('listitem')).toHaveCount(12)
      await expect(first.getByRole('heading')).toHaveCount(1)
      const mobileHeader = page.locator('[data-mobile-context-header]')
      const desktopNavigation = page.getByRole('complementary', { name: '주요 메뉴' })
      const desktopHeight = (page.viewportSize()?.width ?? 0) >= 1280 ? (await desktopNavigation.boundingBox())!.height : 0
      const stickyTop = await mobileHeader.isVisible() ? await mobileHeader.locator('..').evaluate((element) => element.getBoundingClientRect().height) : desktopHeight
      const firstTop = await documentTop(first) - stickyTop
      const nextTop = await documentTop(next) - stickyTop
      const headerHeight = await firstHeader.evaluate((element) => element.getBoundingClientRect().height)

      // Pin the first date, then cross the shared section boundary in both directions.
      await scrollTo(page, firstTop + 80)
      await expectTop(firstHeader, stickyTop)
      await scrollTo(page, nextTop - headerHeight / 2)
      await expectTop(firstHeader, stickyTop - headerHeight / 2)
      await expectTop(nextHeader, stickyTop + headerHeight / 2)
      await page.screenshot({ path: testInfo.outputPath(`date-handoff-${surface}-${theme}.png`) })
      await scrollTo(page, nextTop + 80)
      await expectTop(nextHeader, stickyTop)
      expect(await firstHeader.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(stickyTop)
      await scrollTo(page, nextTop - headerHeight / 2)
      await expectTop(firstHeader, stickyTop - headerHeight / 2)
      await expectTop(nextHeader, stickyTop + headerHeight / 2)
      await scrollTo(page, firstTop + 80)
      await expectTop(firstHeader, stickyTop)

      // Transactions must not show through the pinned label, and each date stays one heading.
      const background = await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)
      await expect(firstHeader).toHaveCSS('background-color', background)
      await expect(firstHeader).toHaveCSS('border-top-width', '1px')
      await expect(first.getByRole('heading')).toHaveCSS('font-size', '12px')
      await expect(first.getByRole('heading')).toHaveCount(1)
      await page.screenshot({ path: testInfo.outputPath(`date-pinned-${surface}-${theme}.png`) })
    }
    }
  } finally {
    await testInfo.attach('console-network-request-ids', { body: JSON.stringify(evidence), contentType: 'application/json' })
  }
})

async function documentTop(locator: Locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)
}

async function scrollTo(page: Page, top: number) {
  await page.evaluate((value) => window.scrollTo(0, value), top)
}

async function expectTop(locator: Locator, top: number) {
  await expect.poll(async () => Math.abs(await locator.evaluate((element) => element.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(1)
}
