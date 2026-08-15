import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { balanceAssetRow, cardAssetRow, expectCardPaymentAmounts } from './support/assets'
import { selectAsset } from './support/asset-picker'
import { registerAndLogin } from './support/auth'
import { selectDate } from './support/date-picker'
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
  const purchaseDate = todayInSeoul()
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
  await expect(page.getByRole('heading', { name: '거래 내역', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(balanceAssetRow(page, '계좌', '-70,000원')).toBeVisible()
  await expectCardPaymentAmounts(cardAssetRow(page, '신용카드'), {
    currentMonth: '0원',
    nextMonth: Number(todayInSeoul().slice(-2)) <= 14 ? '50,000원' : '0원',
  })

  await page.goto(`/?view=calendar&month=${month}`)
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByTitle('-120,000원', { exact: true }).first()).toBeVisible()
  await expect(page.getByTitle('+0원', { exact: true })).toHaveCount(0)
  await expect(page.getByTitle('0원', { exact: true }).first()).toBeVisible()
  await page.getByRole('radio', { name: '모두 모든 구성원 기록 보기' }).locator('..').click()
  await page.getByRole('button', { name: '일별 보기' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: '카드 선결제' })).toHaveCount(2)
  expect(await hasPageOverflow(page)).toBe(false)
})

test('완료된 선결제의 출금 계좌를 바꾸면 명세는 유지하고 두 계좌 잔액만 바로잡는다', async ({ page, request }, testInfo) => {
  const purchaseDate = todayInSeoul()
  const correctedAccountName = `정정 계좌 ${Date.now().toString().slice(-6)}`
  const account = await registerAndLogin(page, request, `결제 계좌 정정 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const correctedAccount = await createPaymentAccount(page, correctedAccountName, 100_000)

  await createCardPurchase(page, {
    amount: '100000',
    occurredOn: purchaseDate,
    description: `QC 결제 계좌 정정 ${Date.now().toString().slice(-6)}`,
  })
  const statement = await openDefaultCardStatement(page)
  await page.getByLabel('선결제 금액').fill('60,000')
  await page.getByRole('button', { name: '결제 영향 확인' }).click()
  await page.getByRole('region', { name: '선결제 영향' }).getByRole('button', { name: '선결제 기록' }).click()
  await expect(page.getByRole('status')).toContainText('60,000원을')
  await expectStatementSummary(page, { gross: '100,000원', paid: '60,000원', remaining: '40,000원' })

  const history = page.getByRole('region', { name: '결제 기록' })
  const paymentRow = history.getByRole('listitem').filter({ hasText: '60,000원' })
  await paymentRow.getByRole('button', { name: '출금 계좌 변경' }).click()
  await selectAsset(page, '변경할 출금 계좌', correctedAccountName, paymentRow)
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'PUT'
      && url.pathname.startsWith(`/api/card-statements/${statement.statementId}/payments/`)
  })
  await paymentRow.getByRole('button', { name: '계좌 변경', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const requestBody = response.request().postDataJSON() as Record<string, unknown>
  expect(requestBody).toEqual({
    settlementAssetId: correctedAccount.assetId,
    expectedVersion: expect.any(Number),
  })

  await expect(page.getByRole('status')).toContainText(`출금 계좌를 ${correctedAccountName}(으)로 변경했어요.`)
  await expect(paymentRow).toContainText(correctedAccountName)
  await expectStatementSummary(page, { gross: '100,000원', paid: '60,000원', remaining: '40,000원' })
  const balances = await assetBalances(page, [statement.accountAssetId, correctedAccount.assetId])
  expect(balances[statement.accountAssetId]).toBe(0)
  expect(balances[correctedAccount.assetId]).toBe(40_000)
  expect(await hasPageOverflow(page)).toBe(false)

  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'correct-completed-payment-account',
    purchaseDate,
    statementId: statement.statementId,
    cardAssetId: statement.cardAssetId,
    accountAssetId: statement.accountAssetId,
    correctedAccountAssetId: correctedAccount.assetId,
  })
})

test('두 세션의 오래된 선결제 preview는 거부되고 금액 draft를 최신 명세에 다시 계산한다', async ({ page, request, browser }, testInfo) => {
  const month = currentMonthInSeoul()
  const purchaseDate = todayInSeoul()
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
  await selectDate(page, '날짜', purchase.occurredOn)
  const category = transactionCategoryTrigger(page)
  await expect(category).toContainText('식비')
  await selectTransactionCategory(page, '식비')
  await selectAsset(page, '결제 자산', '신용카드')
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
  await page.getByRole('link', { name: '자산 편집' }).click()
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

async function createPaymentAccount(page: Page, name: string, openingBalanceWon: number) {
  return page.evaluate(async ({ accountName, balance }) => {
    type AssetType = { assetTypeId: string; systemCode: string }
    type Member = { memberId: string; currentUser: boolean }
    const read = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await read<{ headerName: string; token: string }>('/api/auth/csrf')
    const types = await read<AssetType[]>('/api/asset-types')
    const current = await read<{ ledger: { members: Member[] } }>('/api/ledger-books/current')
    const bankType = types.find((type) => type.systemCode === 'BANK')
    const member = current.ledger.members.find((candidate) => candidate.currentUser)
    if (!bankType || !member) throw new Error('payment account seed prerequisites were not found')
    const response = await fetch('/api/assets', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        [csrf.headerName]: csrf.token,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        assetTypeId: bankType.assetTypeId,
        ownershipScope: 'PERSONAL',
        ownerMemberId: member.memberId,
        name: accountName,
        openedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
        memo: null,
        openingBalanceWon: balance,
        cardSettings: null,
        debitCardSettings: null,
        savingsSettings: null,
      }),
    })
    if (!response.ok) throw new Error(`/api/assets returned ${response.status}: ${await response.text()}`)
    return response.json() as Promise<{ assetId: string; name: string }>
  }, { accountName: name, balance: openingBalanceWon })
}

async function assetBalances(page: Page, assetIds: string[]) {
  return page.evaluate(async (ids) => {
    const response = await fetch('/api/assets', { credentials: 'include' })
    if (!response.ok) throw new Error(`/api/assets returned ${response.status}`)
    const assets = await response.json() as Array<{ assetId: string; currentBalanceWon: number }>
    return Object.fromEntries(assets.filter((asset) => ids.includes(asset.assetId)).map((asset) => [asset.assetId, asset.currentBalanceWon]))
  }, assetIds)
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
