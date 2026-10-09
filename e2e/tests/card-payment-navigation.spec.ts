import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test('카드 결제 내역은 필요할 때 펼치고 상세에서 열린 목록으로 돌아온다', async ({ page }, testInfo) => {
  const card = { assetId: 'card', name: '생활비 카드', assetTypeName: '신용카드', systemCode: 'CREDIT_CARD', behavior: 'CREDIT_CARD', ownershipScope: 'PERSONAL', ownerMemberId: 'me', status: 'ACTIVE', currentBalanceWon: -126000, version: 1, cardSettings: { settlementAssetId: 'bank', autoSettlementEnabled: false } }
  const bank = { assetId: 'bank', name: '생활비 통장', assetTypeName: '계좌', systemCode: 'BANK', behavior: 'STANDARD', ownershipScope: 'PERSONAL', ownerMemberId: 'me', status: 'ACTIVE', paymentSourceCapable: true, currentBalanceWon: 500000, version: 1 }
  const statement = { statementId: 'statement', cardAsset: { assetId: 'card', name: '생활비 카드' }, dueOn: '2026-11-15', status: 'OPEN', grossAmountWon: 126000, paidAmountWon: 0, remainingAmountWon: 126000, prepayableAmountWon: 126000, additionalUsageAfterPayment: false, version: 1, automaticSettlement: null, settlementAsset: { assetId: 'bank', name: '생활비 통장', currentBalanceWon: 500000 }, autoSettlementEnabled: false, payments: [] }
  const fixture: Record<string, unknown> = {
    '/api/auth/me': { userId: 'user', loginId: 'preview', displayName: '지우', email: 'preview@example.test' },
    '/api/ledger-books/current': { ledger: { ledgerId: 'review', version: 1, members: [{ memberId: 'me', displayName: '지우', currentUser: true, joinedAt: '2026-01-01' }] } },
    '/api/assets': [card, bank], '/api/assets/card': card,
    '/api/assets/card/card-payment-items': { items: [], nextCursor: null, recentClosingOn: '2026-09-30', snapshotToken: 'test', totals: { amountWon: 0, count: 0, closedAmountWon: 0, closedCount: 0 } },
    '/api/assets/card/card-statements': { items: [statement], nextCursor: null },
    '/api/card-statements/statement': statement,
  }
  const evidence: unknown[] = [], mutations: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') evidence.push({ console: message.text() }) })
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) evidence.push({ path: new URL(response.url()).pathname, status: response.status(), requestId: response.headers()['x-request-id'] }) })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') { mutations.push(path); await route.fulfill({ status: 405, json: {} }); return }
    await route.fulfill({ status: path in fixture ? 200 : 404, json: fixture[path] ?? {}, headers: { 'X-Request-Id': 'card-navigation-review' } })
  })
  await testInfo.attach('seed-manifest', { body: JSON.stringify({ mocked: true, fixture }), contentType: 'application/json' })
  try {
    await page.goto('/assets/card/card-payment?source=review')
    const list = page.getByRole('region', { name: '카드 결제 내역', exact: true })
    await expect(list).toHaveCount(0)
    await page.getByRole('button', { name: '결제 내역 보기', exact: true }).click()
    await expect(list).toBeVisible()
    await expect(page).toHaveURL(/source=review&history=1/)
    await list.getByRole('link', { name: /카드 결제 내역 보기$/ }).click()
    await expect(page.getByRole('heading', { name: /카드 결제 내역$/ })).toBeVisible()
    await expect(page.getByRole('region', { name: '결제 내역 요약' })).toBeVisible()
    await page.getByRole('link', { name: '카드 대금으로 돌아가기', exact: true }).click()
    await expect(page).toHaveURL(/card-payment\?history=1$/)
    await expect(list).toBeVisible()
    await page.reload()
    await expect(list).toBeVisible()
    await page.getByRole('button', { name: '결제 내역 접기', exact: true }).click()
    await expect(list).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(mutations).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await testInfo.attach('console-network-request-ids', { body: JSON.stringify({ evidence, errors }), contentType: 'application/json' })
  }
})
