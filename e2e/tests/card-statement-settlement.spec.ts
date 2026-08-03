import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { balanceAssetRow, cardAssetRow, expectCardPaymentAmounts } from './support/assets'
import { registerAndLogin } from './support/auth'
import { selectTransactionCategory, transactionCategoryTrigger } from './support/transactions'

type Evidence = {
  runId: string
  console: Array<{ page: string; type: string; text: string }>
  pageErrors: Array<{ page: string; message: string }>
  network: Array<{ page: string; method: string; path: string; status: number; requestId: string | null }>
}

const evidenceByPage = new WeakMap<Page, Evidence>()
const RESPONSIVE_VIEWPORTS = [
  { width: 390, height: 844, label: '390px 모바일' },
  { width: 768, height: 1024, label: 'iPad 세로' },
  { width: 1024, height: 768, label: 'iPad 가로' },
  { width: 1280, height: 900, label: '데스크톱' },
] as const

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }, testInfo) => {
  const runId = `card-settlement-${Date.now()}-${testInfo.workerIndex}-${Math.floor(Math.random() * 10_000)}`
  const evidence: Evidence = { runId, console: [], pageErrors: [], network: [] }
  evidenceByPage.set(page, evidence)
  await page.context().setExtraHTTPHeaders(e2eHeaders(runId, testInfo))
  trackPage(page, evidence, 'writer')
})

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByPage.get(page)
  if (!evidence) return
  await testInfo.attach('card-settlement-console', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, messages: evidence.console, pageErrors: evidence.pageErrors }, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach('card-settlement-network', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, requests: evidence.network }, null, 2)),
    contentType: 'application/json',
  })
})

test('같은 카드 명세에 두 번 부분 선결제하고 음수 계좌·남은 결제·통계 제외를 확인한다', async ({ page, request }, testInfo) => {
  const month = currentMonthInSeoul()
  const purchaseDate = `${month}-05`
  const purchaseDescription = `QC 복수 선결제 ${Date.now().toString().slice(-6)}`
  const account = await registerAndLogin(page, request, `선결제 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  await createCardPurchase(page, { amount: '120000', occurredOn: purchaseDate, description: purchaseDescription })
  const statement = await openDefaultCardStatement(page)
  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'two-partial-prepayments', purchaseDate, purchaseDescription,
    statementId: statement.statementId,
    cardAssetId: statement.cardAssetId,
    accountAssetId: statement.accountAssetId,
  })

  await expectStatementSummary(page, { gross: '120,000원', paid: '0원', remaining: '120,000원' })
  await expect(page.getByText('아직 결제 기록이 없어요.', { exact: true })).toBeVisible()
  const amount = page.getByLabel('선결제 금액')
  await amount.fill('30,000')
  await expectDraftAndFocusAcrossViewports(page, amount, '30,000')

  await page.getByRole('button', { name: '결제 영향 확인' }).click()
  let preview = page.getByRole('region', { name: '선결제 영향' })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('heading', { name: '선결제 영향' })).toBeFocused()
  await expect(preview.getByText('적용일', { exact: true }).locator('..')).toContainText(todayInSeoul())
  await expect(preview.getByText('명세 남은 결제', { exact: true }).locator('..')).toContainText('120,000원 → 90,000원')
  await expect(preview.getByText('계좌 장부', { exact: true }).locator('..')).toContainText('0원 → -30,000원')
  await expect(preview.getByText('수입·지출 통계', { exact: true }).locator('..')).toContainText('변화 없음')
  await expectTouchTarget(preview.getByRole('button', { name: '선결제 기록' }), '선결제 기록')

  const releaseApply = await delayNextRequest(page, '**/api/card-statements/*/prepayments')
  await preview.getByRole('button', { name: '선결제 기록' }).click()
  await expect(page.getByLabel('선결제 금액')).toBeDisabled()
  await expect(preview.getByRole('button', { name: '선결제 기록' })).toBeDisabled()
  releaseApply()
  await expect(page.getByRole('status')).toContainText('30,000원을')
  await expectStatementSummary(page, { gross: '120,000원', paid: '30,000원', remaining: '90,000원' })

  await page.getByLabel('선결제 금액').fill('40,000')
  await page.getByRole('button', { name: '결제 영향 확인' }).click()
  preview = page.getByRole('region', { name: '선결제 영향' })
  await expect(preview.getByText('명세 남은 결제', { exact: true }).locator('..')).toContainText('90,000원 → 50,000원')
  await expect(preview.getByText('계좌 장부', { exact: true }).locator('..')).toContainText('-30,000원 → -70,000원')
  await preview.getByRole('button', { name: '선결제 기록' }).click()
  await expect(page.getByRole('status')).toContainText('40,000원을')
  await expectStatementSummary(page, { gross: '120,000원', paid: '70,000원', remaining: '50,000원' })

  const history = page.getByRole('region', { name: '결제 기록' })
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history.getByRole('listitem').filter({ hasText: '30,000원' })).toContainText('선결제')
  await expect(history.getByRole('listitem').filter({ hasText: '40,000원' })).toContainText('선결제')

  await page.getByRole('link', { name: '카드 자산으로 돌아가기' }).click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await page.getByRole('link', { name: '자산 목록' }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(balanceAssetRow(page, '계좌', '-70,000원')).toBeVisible()
  await expectCardPaymentAmounts(cardAssetRow(page, '신용카드'), { currentMonth: '0원', nextMonth: '50,000원' })

  await page.goto(`/?view=calendar&month=${month}`)
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByTitle('-120,000원', { exact: true }).first()).toBeVisible()
  await expect(page.getByTitle('+0원', { exact: true })).toHaveCount(0)
  await expect(page.getByTitle('0원', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '일별 보기' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: '카드 선결제' })).toHaveCount(2)
  expect(await hasPageOverflow(page)).toBe(false)
})

test('두 세션의 오래된 선결제 preview는 거부되고 금액 draft를 최신 명세에 다시 계산한다', async ({ page, request, browser }, testInfo) => {
  const month = currentMonthInSeoul()
  const purchaseDate = `${month}-07`
  const purchaseDescription = `QC 선결제 충돌 ${Date.now().toString().slice(-6)}`
  const account = await registerAndLogin(page, request, `선결제 충돌 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await createCardPurchase(page, { amount: '100000', occurredOn: purchaseDate, description: purchaseDescription })
  const statement = await openDefaultCardStatement(page)
  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'stale-prepayment-preview', purchaseDate, purchaseDescription,
    statementId: statement.statementId,
    cardAssetId: statement.cardAssetId,
    accountAssetId: statement.accountAssetId,
  })

  const other = await loginInIndependentContext(browser, page, account, testInfo)
  const evidence = evidenceByPage.get(page)
  if (evidence) trackPage(other.page, evidence, 'stale-writer')
  try {
    await other.page.goto(statement.url)
    await expect(other.page.getByRole('heading', { name: /카드 명세$/ })).toBeVisible()
    await other.page.getByLabel('선결제 금액').fill('60,000')
    await other.page.getByRole('button', { name: '결제 영향 확인' }).click()
    await expect(other.page.getByRole('region', { name: '선결제 영향' })).toBeVisible()

    await page.getByLabel('선결제 금액').fill('70,000')
    await page.getByRole('button', { name: '결제 영향 확인' }).click()
    await page.getByRole('region', { name: '선결제 영향' }).getByRole('button', { name: '선결제 기록' }).click()
    await expect(page.getByRole('status')).toContainText('70,000원을')

    const staleResponsePromise = other.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST'
        && url.pathname.endsWith('/prepayments')
    })
    await other.page.getByRole('region', { name: '선결제 영향' }).getByRole('button', { name: '선결제 기록' }).click()
    const staleResponse = await staleResponsePromise
    const problem = await staleResponse.json() as { errorCode?: string; correlationId?: string }
    expect(staleResponse.status()).toBe(412)
    expect(problem.errorCode).toBe('CARD_STATEMENT_PREVIEW_STALE')
    await attachConflictEvidence(testInfo, staleResponse, problem)

    const conflict = other.page.getByRole('alert').filter({ has: other.page.getByRole('heading', { name: '다른 구성원이 이 명세를 먼저 결제했어요' }) })
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText('최신 남은 금액 30,000원')
    await expect(other.page.getByLabel('선결제 금액')).toHaveValue('60,000')
    await conflict.getByRole('button', { name: '최신값으로 영향 다시 계산' }).click()
    await expect(other.page.getByLabel('선결제 금액')).toHaveValue('60,000')
    await expect(other.page.getByText('남은 결제 금액 30,000원 이하로 입력해 주세요.', { exact: true })).toBeVisible()

    await other.page.getByLabel('선결제 금액').fill('20,000')
    await conflict.getByRole('button', { name: '최신값으로 영향 다시 계산' }).click()
    const rebasedPreview = other.page.getByRole('region', { name: '선결제 영향' })
    await expect(rebasedPreview.getByText('명세 남은 결제', { exact: true }).locator('..')).toContainText('30,000원 → 10,000원')
    await rebasedPreview.getByRole('button', { name: '선결제 기록' }).click()
    await expect(other.page.getByRole('status')).toContainText('20,000원을')
    await expectStatementSummary(other.page, { gross: '100,000원', paid: '90,000원', remaining: '10,000원' })
  } finally {
    await other.context.close().catch(() => undefined)
  }
})

async function createCardPurchase(page: Page, purchase: { amount: string; occurredOn: string; description: string }) {
  await page.goto('/transactions/new')
  await expect(page.getByRole('heading', { name: '거래 기록' })).toBeVisible()
  await page.getByLabel('금액').fill(purchase.amount)
  await page.getByLabel('날짜', { exact: true }).fill(purchase.occurredOn)
  const category = transactionCategoryTrigger(page)
  await expect(category).toContainText('식비')
  await selectTransactionCategory(page, '식비')
  await page.getByLabel('결제 자산').selectOption({ label: '신용카드 · 신용카드' })
  await page.getByLabel('할부 개월').fill('1')
  await page.getByLabel('내용 (선택)').fill(purchase.description)
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요.')
}

async function openDefaultCardStatement(page: Page) {
  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  const accountHref = await balanceAssetRow(page, '계좌', '0원').getByRole('link').getAttribute('href')
  const cardLink = cardAssetRow(page, '신용카드').getByRole('link')
  const cardHref = await cardLink.getAttribute('href')
  await cardLink.click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  const list = page.getByRole('region', { name: '카드 결제 내역' })
  await expect(list).toBeVisible()
  await list.getByRole('link', { name: /카드 명세 보기$/ }).first().click()
  await expect(page.getByRole('heading', { name: /카드 명세$/ })).toBeVisible()
  const url = page.url()
  return {
    url,
    statementId: statementIdFromUrl(url),
    cardAssetId: assetIdFromHref(cardHref),
    accountAssetId: assetIdFromHref(accountHref),
  }
}

async function expectStatementSummary(page: Page, expected: { gross: string; paid: string; remaining: string }) {
  const summary = page.getByRole('region', { name: '명세 요약' })
  await expect(summary.getByText('청구 금액', { exact: true }).locator('..')).toContainText(expected.gross)
  await expect(summary.getByText('결제 완료', { exact: true }).locator('..')).toContainText(expected.paid)
  await expect(summary.getByText('남은 결제', { exact: true }).locator('..')).toContainText(expected.remaining)
}

async function expectDraftAndFocusAcrossViewports(page: Page, field: Locator, value: string) {
  const originalViewport = page.viewportSize()
  await field.focus()
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(field, `${viewport.label}에서 금액 draft가 유지되어야 합니다`).toHaveValue(value)
    await expect(field, `${viewport.label}에서 금액 focus가 유지되어야 합니다`).toBeFocused()
    expect(await hasPageOverflow(page), `${viewport.label}에서 페이지 가로 overflow가 없어야 합니다`).toBe(false)
    await expectTouchTarget(page.getByRole('button', { name: '결제 영향 확인' }), `${viewport.label} 결제 영향 확인`)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
  await expect(field).toHaveValue(value)
  await expect(field).toBeFocused()
}

async function loginInIndependentContext(
  browser: Browser,
  sourcePage: Page,
  account: { loginId: string; password: string },
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const evidence = evidenceByPage.get(sourcePage)
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL ?? process.env.BASE_URL ?? 'http://127.0.0.1:5173'),
    viewport: sourcePage.viewportSize() ?? { width: 1280, height: 720 },
    extraHTTPHeaders: e2eHeaders(evidence?.runId ?? `card-settlement-${Date.now()}`, testInfo),
  })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('아이디').fill(account.loginId)
  await page.getByLabel('비밀번호').fill(account.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  return { context, page }
}

function trackPage(page: Page, evidence: Evidence, label: string) {
  page.on('console', (message) => evidence.console.push({ page: label, type: message.type(), text: message.text() }))
  page.on('pageerror', (error) => evidence.pageErrors.push({ page: label, message: error.message }))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/')) return
    evidence.network.push({
      page: label,
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
      requestId: response.headers()['x-request-id'] ?? null,
    })
  })
}

function e2eHeaders(runId: string, testInfo: TestInfo) {
  return {
    'X-E2E-Run-Id': runId,
    'X-E2E-Test-Id': Buffer.from(testInfo.testId).toString('base64url'),
  }
}

async function attachSeedManifest(testInfo: TestInfo, page: Page, loginId: string, flow: Record<string, string>) {
  const evidence = evidenceByPage.get(page)
  await testInfo.attach('card-settlement-seed-manifest', {
    body: Buffer.from(JSON.stringify({
      runId: evidence?.runId,
      seedVersion: 'card-statement-ui-v1',
      migrationVersion: 'V13',
      loginId,
      timezone: 'Asia/Seoul',
      ...flow,
    }, null, 2)),
    contentType: 'application/json',
  })
}

async function attachConflictEvidence(
  testInfo: TestInfo,
  response: { status(): number; headers(): Record<string, string> },
  problem: { errorCode?: string; correlationId?: string },
) {
  await testInfo.attach('card-statement-preview-conflict', {
    body: Buffer.from(JSON.stringify({
      status: response.status(),
      errorCode: problem.errorCode,
      correlationId: problem.correlationId,
      requestId: response.headers()['x-request-id'],
    }, null, 2)),
    contentType: 'application/json',
  })
}

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} 조작 영역이 보여야 합니다`).not.toBeNull()
  expect(box!.width, `${label} 조작 영역 너비`).toBeGreaterThanOrEqual(44)
  expect(box!.height, `${label} 조작 영역 높이`).toBeGreaterThanOrEqual(44)
}

function statementIdFromUrl(url: string) {
  return new URL(url).pathname.split('/').at(-1) ?? ''
}

function assetIdFromHref(href: string | null) {
  return href?.split('/').filter(Boolean).at(-1) ?? 'unknown'
}

function currentMonthInSeoul() {
  return todayInSeoul().slice(0, 7)
}

function todayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

async function delayNextRequest(page: Page, url: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(url, async (route) => {
    await gate
    await route.continue()
  }, { times: 1 })
  return release
}
