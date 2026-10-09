import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

// Read-only UI fixtures keep spacing regression checks independent of payment mutations.
const member = { memberId: 'qc-member', displayName: '테스트 구성원', currentUser: true, joinedAt: '2026-01-01T00:00:00Z' }
const statement = {
  statementId: 'qc-statement', cardAsset: { assetId: 'qc-card', name: '테스트 카드' },
  dueOn: '2026-09-14', status: 'FINALIZED', grossAmountWon: 911829, paidAmountWon: 0,
  remainingAmountWon: 911829, additionalUsageAfterPayment: false, version: 0,
  automaticSettlement: null, prepayableAmountWon: 0, autoSettlementEnabled: false, payments: [],
  settlementAsset: { assetId: 'qc-bank', name: '테스트 결제 계좌', currentBalanceWon: 0 },
}
const transaction = {
  transactionId: 'qc-payment', type: 'TRANSFER', transferSubtype: 'CARD_SETTLEMENT', managementType: 'SYSTEM',
  relatedPurchaseTransactionId: null,
  cardPayment: { statementId: statement.statementId, paymentId: 'qc-payment', paymentType: 'MANUAL', statementVersion: 0, returnedAmountWon: 0 },
  occurredOn: '2026-10-07', amountWon: 911829, statisticsAmountWon: 0, category: null,
  performedBy: member, createdBy: member, asset: statement.cardAsset,
  description: '카드 대금 수동 결제', excludedFromStatistics: true, installmentCount: null, version: 0,
  createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z',
  postings: [{ assetId: 'qc-bank', assetName: '테스트 결제 계좌', deltaWon: -911829 }, { assetId: 'qc-card', assetName: '테스트 카드', deltaWon: 911829 }],
}

const evidence = new WeakMap<Page, { errors: string[]; network: unknown[] }>()

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = []
  const network: Array<{ method: string; path: string; status: number; requestId: string | null }> = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) network.push({ method: response.request().method(), path, status: response.status(), requestId: response.headers()['x-request-id'] ?? null })
  })
  const fixtures: Record<string, unknown> = {
    '/api/auth/me': { userId: 'qc-user', loginId: 'qc-user', displayName: member.displayName, email: 'qc@example.test' },
    '/api/ledger-books/current': { ledger: { ledgerId: 'qc-ledger', version: 0, members: [member] } },
    '/api/card-statements/qc-statement': statement,
    '/api/transactions/qc-payment': transaction,
    '/api/assets': [],
    '/api/assets/qc-card': { ...statement.cardAsset, status: 'ACTIVE' },
  }
  await testInfo.attach('seed-manifest', { body: JSON.stringify({ fixture: 'dialog-spacing', statement, transaction }), contentType: 'application/json' })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET' || !(path in fixtures)) throw new Error(`Unexpected UI fixture request: ${route.request().method()} ${path}`)
    await route.fulfill({ json: fixtures[path] })
  })
  evidence.set(page, { errors, network })
})

test.afterEach(async ({ page }, testInfo) => {
  const captured = evidence.get(page)
  await testInfo.attach('console', { body: JSON.stringify(captured?.errors ?? []), contentType: 'application/json' })
  await testInfo.attach('network', { body: JSON.stringify(captured?.network ?? []), contentType: 'application/json' })
})

for (const scenario of [
  { name: '미결제 대금 결제', path: '/assets/qc-card/card-statements/qc-statement', trigger: '결제하기', close: '닫기' },
  { name: '수동 결제를 취소할까요?', path: '/transactions/qc-payment/edit', trigger: '수동 결제 취소', close: '유지' },
]) {
  test(`${scenario.name} 모달은 모든 화면에서 내용과 테두리 사이 여백을 유지한다`, async ({ page }, testInfo) => {
    await page.goto(scenario.path)
    await page.getByRole('button', { name: scenario.trigger, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: scenario.name, exact: true })
    await expect(dialog).toContainText('911,829원')
    await expectConfirmationSpacing(page, dialog, testInfo, scenario.trigger)
    await dialog.getByRole('button', { name: scenario.close, exact: true }).click()
    await expect(dialog).toBeHidden()
  })
}

async function expectConfirmationSpacing(page: Page, dialog: Locator, testInfo: TestInfo, name: string) {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 639, height: 800 },
    { width: 640, height: 800 },
    { width: 390, height: 844 },
    { width: 767, height: 1024 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    await testInfo.attach(`${name}-${viewport.width}`, { body: await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`) }), contentType: 'image/png' })
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(15)
    expect(box!.y).toBeGreaterThanOrEqual(15)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 15)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 15)
    const minimumInset = viewport.width < 640 ? 20 : 24
    for (const content of await dialog.getByRole('heading').or(dialog.getByRole('paragraph')).or(dialog.getByRole('button')).all()) {
      const contentBox = await content.boundingBox()
      expect(contentBox).not.toBeNull()
      expect(contentBox!.x - box!.x, `${name} ${viewport.width}px 왼쪽 안쪽 여백`).toBeGreaterThanOrEqual(minimumInset)
      expect(box!.x + box!.width - contentBox!.x - contentBox!.width, `${name} ${viewport.width}px 오른쪽 안쪽 여백`).toBeGreaterThanOrEqual(minimumInset)
      expect(contentBox!.y - box!.y, `${name} ${viewport.width}px 위쪽 안쪽 여백`).toBeGreaterThanOrEqual(minimumInset)
      expect(box!.y + box!.height - contentBox!.y - contentBox!.height, `${name} ${viewport.width}px 아래쪽 안쪽 여백`).toBeGreaterThanOrEqual(minimumInset)
    }
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  }
}
