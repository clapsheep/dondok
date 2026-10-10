import { expect, test } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test.use({ serviceWorkers: 'block' })

test('승인한 홈은 날짜·구성원·검색과 기록 날짜를 유지하며 포커스를 구분한다', async ({ page }, testInfo) => {
  const ledger = { ledgerId: 'home-review', version: 1, members: [
    { memberId: 'me', displayName: '지우', currentUser: true, joinedAt: '2026-01-01' },
    { memberId: 'other', displayName: '민서', currentUser: false, joinedAt: '2026-01-01' },
  ] }
  const evidence: unknown[] = []
  page.on('pageerror', error => evidence.push({ error: error.message }))
  page.on('console', message => { if (message.type() === 'error') evidence.push({ console: message.text() }) })
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) evidence.push({ path: new URL(response.url()).pathname, status: response.status(), requestId: response.headers()['x-request-id'] }) })
  await testInfo.attach('seed-manifest', { body: JSON.stringify({ ledger, scenario: 'home-layout-mocked-no-writes' }), contentType: 'application/json' })
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const other = url.searchParams.get('performedByMemberId') === 'other'
    const month = url.searchParams.get('month') ?? '2026-10'
    const item = { transactionId: 'lunch', type: 'EXPENSE', transferSubtype: null, transferPurpose: null, managementType: 'GENERAL', relatedPurchaseTransactionId: null, cardPayment: null, occurredOn: '2026-10-09', amountWon: 12000, statisticsAmountWon: 12000, category: { categoryId: 'food', name: '식비' }, performedBy: { memberId: 'me', displayName: '지우' }, createdBy: { memberId: 'me', displayName: '지우' }, asset: { assetId: 'cash', name: '지갑' }, description: '점심 식사', excludedFromStatistics: false, postings: [{ assetId: 'cash', assetName: '지갑', deltaWon: -12000 }], installmentCount: null, version: 1, createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' }
    let data: unknown = []
    if (url.pathname === '/api/auth/me') data = { userId: 'home-user', loginId: 'preview', displayName: '지우', email: 'home@example.test' }
    if (url.pathname === '/api/ledger-books/current') data = { ledger }
    if (url.pathname === '/api/transactions/calendar') data = { month, totalIncomeWon: other ? 0 : 3800000, totalExpenseWon: other ? 0 : 12000, netWon: other ? 0 : 3788000, days: other ? [] : [{ date: `${month}-09`, incomeWon: 0, expenseWon: 12000, netWon: -12000, cardPaymentWon: 0, transactionCount: 1 }] }
    if (url.pathname === '/api/transactions') data = { items: other || url.searchParams.get('q') === '없음' ? [] : [item], nextCursor: null }
    if (url.pathname === '/api/assets') data = [{ assetId: 'cash', name: '지갑', systemCode: 'CASH', behavior: 'STANDARD', assetTypeName: '현금', ownerMemberId: 'me', ownershipScope: 'PERSONAL', status: 'ACTIVE', currentBalanceWon: 100000, nearestCardPaymentDueWon: 0, followingCardPaymentDueWon: 0 }]
    if (url.pathname === '/api/categories') data = [{ categoryId: 'food', name: '식비', kind: 'EXPENSE', isFallback: false, version: 1 }]
    return route.fulfill({ json: data, headers: { 'X-Request-Id': 'home-fixture' } })
  })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?month=2026-10&date=2026-10-09')
    const summary = page.getByRole('region', { name: '이번 달 요약' })
    const panel = page.getByRole('complementary', { name: '선택한 날짜의 기록' }).or(page.getByRole('dialog', { name: '선택한 날짜의 기록' }))
    await expect(summary).toContainText('12,000원')
    await expect(panel.getByRole('link', { name: /점심 식사/ })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel).not.toBeVisible()
    await page.getByRole('button', { name: /^10월 9일.*선택$/ }).click()
    await expect(page.getByRole('dialog', { name: '선택한 날짜의 기록' })).toBeVisible()
    const calendarScroll = await page.evaluate(() => window.scrollY)
    await panel.getByRole('button', { name: '내역 창 펼치기' }).click()
    await expect(panel).toHaveAttribute('data-expanded', 'true')
    await panel.getByRole('button', { name: '내역 창 줄이기' }).click()
    await expect(panel).toHaveAttribute('data-expanded', 'false')
    await panel.getByRole('button', { name: '다음 날', exact: true }).click()
    await expect(page).toHaveURL(/date=2026-10-10/)
    await panel.getByRole('button', { name: '이전 날', exact: true }).click()
    await expect(page).toHaveURL(/date=2026-10-09/)
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    expect(Math.abs(await page.evaluate(() => window.scrollY) - calendarScroll)).toBeLessThan(2)
    await expect(page.getByRole('button', { name: /^10월 9일.*선택$/ })).toBeFocused()
    await page.getByRole('button', { name: /^10월 9일.*선택$/ }).click()
    await page.goBack()
    await expect(panel).not.toBeVisible()
    await page.goForward()
    await expect(panel).toBeVisible()
    await page.reload()
    await expect(panel).toBeVisible()
    for (const width of [320, 390, 834, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('gridcell', { name: /10월 9일/, includeHidden: true })).toHaveAttribute('aria-selected', 'true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(panel.getByRole('heading', { name: /10월 9일/ })).toBeVisible()
    }
    await page.getByRole('radio', { name: '민서 기록 보기' }).click()
    await expect(page.getByRole('radio', { name: '민서 기록 보기' })).toBeChecked()
    await expect(summary).toContainText('민서의 기록')
    await expect(panel).toContainText('이 날짜에 기록한 거래가 없어요.')
    await expect(page).toHaveURL(/member=other/)
    await page.getByRole('radio', { name: '내 기록 보기' }).click()
    await expect(page.getByRole('radio', { name: '내 기록 보기' })).toBeChecked()
    await page.getByRole('button', { name: '일별 보기', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await page.getByRole('button', { name: /검색/ }).click()
    await page.getByRole('textbox', { name: /검색/ }).fill('없음')
    await page.getByRole('textbox', { name: /검색/ }).press('Enter')
    await expect(page).toHaveURL(/q=/)
    await page.reload()
    await expect(page.getByRole('textbox', { name: /검색/ })).toHaveValue('없음')
    await page.getByRole('button', { name: '월간 달력', exact: true }).click()
    await expect(panel).toBeVisible()
    const previous = page.getByRole('button', { name: '이전 달', exact: true })
    await previous.click()
    await expect(previous).not.toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Tab')
    const next = page.getByRole('button', { name: '다음 달', exact: true })
    await expect(next).toBeFocused()
    await expect(next).toHaveCSS('outline-width', '2px')
    await next.press('Enter')
    await expect(page.locator('[data-month-title]')).toHaveText('2026년 10월')
    // Changing months selects that month's default date; explicitly choose the fixture day.
    await page.getByRole('gridcell', { name: /10월 9일/ }).click()
    await expect(page).toHaveURL(/date=2026-10-09/)
    await panel.getByRole('link', { name: /거래 기록/ }).click()
    await expect(page.getByRole('button', { name: '날짜', exact: true })).toContainText('2026. 10. 9.')
    expect(evidence.filter((entry: any) => entry.error)).toEqual([])
  } finally {
    await testInfo.attach('console-network-request-ids', { body: JSON.stringify(evidence), contentType: 'application/json' })
  }
})

test('기관 정보를 보내는 이전 요청도 자산 종류와 금액을 유지하고 새 폼은 기관 선택을 제공하지 않는다', async ({ page, request }) => {
  await registerAndLogin(page, request, '아이콘 자산 검증')
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const ledger = (await (await page.request.get('/api/ledger-books/current')).json()).ledger
  const types = await (await page.request.get('/api/asset-types')).json()
  const csrf = await (await page.request.get('/api/auth/csrf')).json()
  const key = `icons-${Date.now()}`
  const payload = { assetTypeId: types.find((type: any) => type.systemCode === 'BANK').assetTypeId, ownershipScope: 'PERSONAL', ownerMemberId: ledger.members[0].memberId, name: '그대로 남을 내 통장', openedOn: '2026-10-01', openingBalanceWon: 123456, memo: null, financialInstitutionCode: 'SB_SBI', cardIssuerCode: 'SAMSUNG', cardSettings: null, debitCardSettings: null, savingsSettings: null }
  const create = () => page.request.post('/api/assets', { headers: { [csrf.headerName]: csrf.token, 'Idempotency-Key': key }, data: payload })
  const response = await create()
  expect(response.status()).toBe(201)
  const asset = await response.json()
  expect(asset.financialInstitutionCode).toBeUndefined()
  expect(asset.cardIssuerCode).toBeUndefined()
  expect(asset.currentBalanceWon).toBe(123456)
  expect((await (await create()).json()).assetId).toBe(asset.assetId)
  await page.goto(`/assets/${asset.assetId}/edit`)
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue(payload.name)
  await expect(page.getByLabel('금융기관', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('은행', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('카드사', { exact: true })).toHaveCount(0)
  await page.goto('/assets')
  const link = page.getByRole('link', { name: /그대로 남을 내 통장.*현재 잔액/ })
  await expect(link.locator('[data-asset-icon="BANK"]')).toBeVisible()
  await expect(link.locator('img')).toHaveCount(0)
  await expect(link).toContainText('123,456원')
})
