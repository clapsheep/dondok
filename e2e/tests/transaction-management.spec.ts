import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { submitQuickAsset } from './support/assets'
import { selectAsset } from './support/asset-picker'
import { registerAndLogin } from './support/auth'
import { selectTransactionCategory } from './support/transactions'

test('자산 상세는 돌아가기·기준일 잔액·거래 후 잔액을 보여주고 거래 상세와 자산 편집으로 이어진다', async ({ page, request }) => {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768
  const suffix = `${test.info().workerIndex}-${Date.now().toString().slice(-6)}`
  const assetName = `모바일 원장 계좌 ${suffix}`
  const latestDescription = `QC 자산 최신 ${suffix}`
  const olderDescription = `QC 자산 이전 ${suffix}`
  const quickDescription = `QC 원장 바로 기록 ${suffix}`

  await registerAndLogin(page, request, `자산 원장 사용자 ${suffix}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.goto('/assets/new')
  await submitQuickAsset(page, {
    typeName: '계좌',
    name: assetName,
    amount: '300000',
    expectedName: assetName,
    expectedAmount: '300,000원',
  })
  const seeded = await seedAssetLedgerTransactions(page, assetName, [
    { occurredOn: '2026-08-12', amountWon: 18_000, description: latestDescription },
    { occurredOn: '2026-07-28', amountWon: 7_000, description: olderDescription },
  ])

  await page.goto('/assets')
  await page.getByRole('link', { name: new RegExp(`^${escapeRegExp(assetName)},`) }).click()
  await expect(page).toHaveURL(new RegExp(`/assets/${seeded.assetId}$`))
  await expect(page.getByRole('heading', { name: assetName, exact: true })).toBeVisible()
  const backToAssets = page.getByRole('link', { name: mobile ? '자산 목록으로' : '자산 현황으로', exact: true })
  await expect(backToAssets).toBeVisible()
  await expect(backToAssets).toHaveAttribute('href', '/assets')
  await expect(page.getByRole('heading', { name: '2026년 8월', exact: true })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '2026년 7월', exact: true })).toHaveCount(1)
  const openingBalance = page.locator('[data-opening-balance]')
  await expect(openingBalance).toContainText('기준일 잔액')
  await expect(openingBalance).toContainText('300,000원')
  await expect(transactionRow(page, latestDescription)).toContainText('잔액 300,000원')
  await expect(transactionRow(page, olderDescription)).toContainText('잔액 318,000원')
  const editAsset = page.getByRole('link', { name: '자산 편집' })
  await expectTouchTarget(editAsset, '자산 편집')
  expect(await hasPageOverflow(page)).toBe(false)

  const ledgerUrl = page.url()
  await page.getByRole('button', { name: '기록 추가', exact: true }).click()
  const recordDialog = page.getByRole('dialog', { name: '거래 기록' })
  await expect(recordDialog).toBeVisible()
  await expect(page).toHaveURL(ledgerUrl)
  await expect(recordDialog.getByRole('button', { name: '결제 자산' })).toContainText(assetName)
  await recordDialog.getByLabel('금액').fill('9000')
  await recordDialog.getByRole('button', { name: /^분류 선택, 현재 / }).click()
  const categoryDialog = page.getByRole('dialog', { name: /분류 선택$/ })
  await categoryDialog.getByRole('button', { name: '식비', exact: true }).click()
  await recordDialog.getByLabel('내용 (선택)').fill(quickDescription)
  await recordDialog.getByRole('button', { name: '거래 기록 닫기' }).click()
  const discardDialog = page.getByRole('dialog', { name: '작성 중인 기록을 닫을까요?' })
  await expect(discardDialog).toBeVisible()
  await discardDialog.getByRole('button', { name: '계속 작성' }).click()
  await expect(recordDialog.getByLabel('내용 (선택)')).toHaveValue(quickDescription)
  await recordDialog.getByRole('button', { name: '기록 저장' }).click()
  await expect(recordDialog).toHaveCount(0)
  await expect(page).toHaveURL(ledgerUrl)
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요.')
  await expect(transactionRow(page, quickDescription)).toContainText('-9,000원')
  await expect(page.getByText('현재 잔액', { exact: true }).locator('..')).toContainText('291,000원')

  await page.getByRole('link', { name: `${latestDescription} 거래 상세` }).click()
  await expect(page.getByRole('heading', { name: '거래 상세' })).toBeVisible()
  await expect(page.getByText('-18,000원', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '기록 편집' })).toBeVisible()
  await expect(page.getByRole('button', { name: '기록 삭제' })).toBeVisible()
  await page.getByRole('link', { name: mobile ? '거래 목록으로' : '목록으로 돌아가기', exact: true }).click()
  await editAsset.click()
  await expect(page).toHaveURL(new RegExp(`/assets/${seeded.assetId}/edit$`))
  await expect(page.getByRole('heading', { name: mobile ? '자산 편집' : '자산 정보 수정', exact: true })).toBeVisible()
})

test('일반 거래는 종류를 바꾸지 않고 수정한 뒤 잔액과 통계에서 삭제할 수 있다', async ({ page, request }) => {
  const suffix = `${test.info().workerIndex}-${Date.now().toString().slice(-6)}`
  const before = `QC 수정 전 ${suffix}`
  const after = `QC 수정 후 ${suffix}`

  await registerAndLogin(page, request, `거래 관리자 ${suffix}`)
  await prepareLedgerWithBank(page)
  await createExpense(page, { amount: '17000', description: before })

  const originalRow = transactionRow(page, before)
  await expect(originalRow).toContainText('-17,000원')
  await originalRow.getByRole('link', { name: `${before} 거래 상세` }).click()
  await expect(page.getByRole('heading', { name: '거래 상세' })).toBeVisible()
  await page.getByRole('link', { name: '기록 편집' }).click()
  await expect(page.getByRole('heading', { name: '거래 수정' })).toBeVisible()
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await expect(page.getByRole('link', { name: '거래 목록으로', exact: true })).toBeVisible()
  }
  await expect(page.getByLabel('거래 종류')).toHaveText('지출')
  await expect(page.getByRole('button', { name: '수입', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '이체', exact: true })).toHaveCount(0)

  await page.getByLabel('금액').fill('24000')
  const description = page.getByLabel('내용 (선택)')
  await description.fill(after)
  await expectTransactionDraftAcrossWidths(page, description, after)
  await page.getByRole('button', { name: '변경 저장' }).click()

  await expect(page.getByRole('status')).toContainText('거래를 수정했어요.')
  const updatedRow = transactionRow(page, after)
  await expect(updatedRow).toContainText('-24,000원')
  await expect(transactionRow(page, before)).toHaveCount(0)

  await updatedRow.getByRole('link', { name: `${after} 거래 상세` }).click()
  await expect(page.getByRole('heading', { name: '거래 상세' })).toBeVisible()
  await expect(page.getByText('-24,000원', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '기록 삭제' }).click()
  await expect(page.getByRole('heading', { name: '이 거래를 삭제할까요?' })).toBeVisible()
  await expect(page.getByText('자산 잔액을 되돌리고 달력과 통계에서도 제거합니다.', { exact: true })).toBeVisible()
  const deleteButton = page.getByRole('button', { name: '삭제하기', exact: true })
  await expectTouchTarget(deleteButton, '거래 삭제')
  await deleteButton.click()

  await expect(page.getByRole('status')).toContainText('거래를 삭제했어요.')
  await expect(transactionRow(page, after)).toHaveCount(0)
  await expect(page.getByText('-24,000원', { exact: true })).toHaveCount(0)
  expect(await hasPageOverflow(page)).toBe(false)
})

test('계좌 지출은 신용카드 구매로 정정하고 이전 계좌 잔액과 카드 할부 명세를 함께 맞춘다', async ({ page, request }) => {
  const suffix = `${test.info().workerIndex}-${Date.now().toString().slice(-6)}`
  const before = `QC 계좌 지출 ${suffix}`
  const after = `QC 카드 정정 ${suffix}`

  await registerAndLogin(page, request, `카드 전환 관리자 ${suffix}`)
  await prepareLedgerWithBank(page)
  await createExpense(page, {
    amount: '10000',
    description: before,
    assetName: '거래 관리 계좌',
  })

  await transactionRow(page, before).getByRole('link', { name: `${before} 거래 상세` }).click()
  await page.getByRole('link', { name: '기록 편집' }).click()
  await expect(page.getByRole('heading', { name: '거래 수정' })).toBeVisible()
  await expect(page.getByLabel('할부 개월')).toHaveCount(0)
  await selectAsset(page, '결제 자산', '신용카드')
  await expect(page.getByLabel('할부 개월')).toBeVisible()
  await page.getByLabel('할부 개월').fill('3')
  await page.getByLabel('금액').fill('30000')
  await page.getByLabel('내용 (선택)').fill(after)

  const updateResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'PUT' && /^\/api\/transactions\/[^/]+$/.test(url.pathname)
  })
  await page.getByRole('button', { name: '변경 저장' }).click()
  const updateResponse = await updateResponsePromise
  expect(updateResponse.status()).toBe(200)
  const updated = await updateResponse.json() as {
    managementType: string
    amountWon: number
    installmentCount: number | null
    asset: { assetId: string; name: string } | null
    postings: Array<{ assetId: string; deltaWon: number }>
  }
  expect(updated).toMatchObject({
    managementType: 'CARD_PURCHASE',
    amountWon: 30_000,
    installmentCount: 3,
    asset: { name: '신용카드' },
  })
  expect(updated.postings).toHaveLength(1)
  expect(updated.postings[0]).toMatchObject({ assetId: updated.asset?.assetId, deltaWon: -30_000 })

  await expect(page.getByRole('status')).toContainText('거래를 수정했어요.')
  const correctedRow = page.getByRole('listitem').filter({ hasText: after })
  await expect(correctedRow).toContainText('-30,000원')
  await expect(transactionRow(page, before)).toHaveCount(0)

  const ledger = await page.evaluate(async () => {
    const assetsResponse = await fetch('/api/assets')
    if (!assetsResponse.ok) throw new Error(`자산 조회 실패: ${assetsResponse.status}`)
    const assets = await assetsResponse.json() as Array<{
      assetId: string
      name: string
      currentBalanceWon: number
    }>
    const bank = assets.find((asset) => asset.name === '거래 관리 계좌')
    const card = assets.find((asset) => asset.name === '신용카드')
    if (!bank || !card) throw new Error('검증할 계좌 또는 신용카드를 찾지 못했습니다.')
    const statementsResponse = await fetch(`/api/assets/${card.assetId}/card-statements?includePaid=false&limit=20`)
    if (!statementsResponse.ok) throw new Error(`카드 명세 조회 실패: ${statementsResponse.status}`)
    const statements = await statementsResponse.json() as {
      items: Array<{ grossAmountWon: number; remainingAmountWon: number }>
    }
    return { bank, card, statements: statements.items }
  })
  expect(ledger.bank.currentBalanceWon).toBe(400_000)
  expect(ledger.card.currentBalanceWon).toBe(-30_000)
  expect(ledger.statements).toHaveLength(3)
  expect(ledger.statements.reduce((sum, statement) => sum + statement.grossAmountWon, 0)).toBe(30_000)
  expect(ledger.statements.reduce((sum, statement) => sum + statement.remainingAmountWon, 0)).toBe(30_000)

  await correctedRow.getByRole('link', { name: `${after} 거래 상세` }).click()
  await expect(page.getByRole('heading', { name: '카드 구매 상세' })).toBeVisible()
  await expect(page.getByText('결제 방식', { exact: true }).locator('..')).toContainText('3개월 할부')
  expect(await hasPageOverflow(page)).toBe(false)
})

test('두 독립 세션의 같은 거래 수정은 오래된 저장을 거부하고 draft를 최신 버전에 다시 적용한다', async ({ page, request, browser }, testInfo) => {
  const suffix = `${test.info().workerIndex}-${Date.now().toString().slice(-6)}`
  const original = `QC 충돌 원본 ${suffix}`
  const serverLatest = `QC 서버 최신 ${suffix}`
  const preservedDraft = `QC 보존 draft ${suffix}`

  const account = await registerAndLogin(page, request, `충돌 관리자 ${suffix}`)
  await prepareLedgerWithBank(page)
  await createExpense(page, { amount: '31000', description: original })
  await transactionRow(page, original).getByRole('link', { name: `${original} 거래 상세` }).click()
  await page.getByRole('link', { name: '기록 편집' }).click()
  const detailUrl = page.url()
  const detailApiPath = `/api${new URL(detailUrl).pathname.replace(/\/edit$/, '')}`

  const other = await loginInIndependentContext(browser, page, account, testInfo)
  try {
    await other.page.goto(detailUrl)
    await expect(other.page.getByRole('heading', { name: '거래 수정' })).toBeVisible()
    await other.page.getByLabel('내용 (선택)').fill(preservedDraft)

    await page.getByLabel('내용 (선택)').fill(serverLatest)
    await page.getByRole('button', { name: '변경 저장' }).click()
    await expect(page.getByRole('status')).toContainText('거래를 수정했어요.')

    const conflictResponsePromise = other.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'PUT' && url.pathname === detailApiPath
    })
    await other.page.getByRole('button', { name: '변경 저장' }).click()
    const conflictResponse = await conflictResponsePromise
    const problem = await conflictResponse.json() as { errorCode?: string; correlationId?: string }
    expect(conflictResponse.status()).toBe(412)
    expect(problem.errorCode).toBe('VERSION_CONFLICT')
    await attachConflictEvidence(testInfo, conflictResponse, problem)

    const conflict = other.page.getByRole('region', { name: '다른 구성원이 먼저 거래를 변경했어요' })
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText(serverLatest)
    await expect(conflict).toContainText(preservedDraft)
    await expect(other.page.getByLabel('내용 (선택)')).toHaveValue(preservedDraft)

    await other.page.getByRole('button', { name: '최신 버전에 내 입력 적용' }).click()
    await expect(other.page.getByLabel('내용 (선택)')).toHaveValue(preservedDraft)
    await other.page.getByRole('button', { name: '변경 저장' }).click()
    await expect(other.page.getByRole('status')).toContainText('거래를 수정했어요.')
    await expect(transactionRow(other.page, preservedDraft)).toContainText('-31,000원')
  } finally {
    await other.context.close().catch(() => undefined)
  }
})

async function prepareLedgerWithBank(page: Page) {
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.goto('/assets/new')
  await submitQuickAsset(page, {
    typeName: '계좌',
    name: '거래 관리 계좌',
    amount: '400000',
    expectedName: '거래 관리 계좌',
    expectedAmount: '400,000원',
  })
}

async function createExpense(page: Page, transaction: { amount: string; description: string; assetName?: string }) {
  await page.goto('/transactions/new')
  await page.getByLabel('금액').fill(transaction.amount)
  await selectTransactionCategory(page, '식비')
  if (transaction.assetName) await selectAsset(page, '결제 자산', transaction.assetName)
  await page.getByLabel('내용 (선택)').fill(transaction.description)
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요.')
}

async function seedAssetLedgerTransactions(page: Page, assetName: string, inputs: Array<{ occurredOn: string; amountWon: number; description: string }>) {
  return page.evaluate(async ({ assetName, inputs }) => {
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const current = await requiredJson<{ ledger: { members: Array<{ memberId: string; currentUser: boolean }> } }>('/api/ledger-books/current')
    const assets = await requiredJson<Array<{ assetId: string; name: string }>>('/api/assets')
    const categories = await requiredJson<Array<{ categoryId: string; systemCode: string | null }>>('/api/categories?kind=EXPENSE')
    const asset = assets.find((item) => item.name === assetName)
    const member = current.ledger.members.find((item) => item.currentUser)
    const category = categories.find((item) => item.systemCode === 'FOOD') ?? categories[0]
    if (!asset || !member || !category) throw new Error('자산 원장 seed 대상을 찾지 못했습니다.')
    for (const input of inputs) {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          [csrf.headerName]: csrf.token,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          type: 'EXPENSE',
          occurredOn: input.occurredOn,
          amountWon: input.amountWon,
          categoryId: category.categoryId,
          assetId: asset.assetId,
          performedByMemberId: member.memberId,
          description: input.description,
          installmentCount: 1,
          excludedFromStatistics: false,
        }),
      })
      if (!response.ok) throw new Error(`거래 seed returned ${response.status}`)
    }
    return { assetId: asset.assetId }
  }, { assetName, inputs })
}

function transactionRow(page: Page, label: string) {
  return page.getByRole('listitem').filter({ has: page.getByRole('link', { name: `${label} 거래 상세` }) })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loginInIndependentContext(
  browser: Browser,
  sourcePage: Page,
  account: { loginId: string; password: string },
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL ?? process.env.BASE_URL ?? 'http://127.0.0.1:5173'),
    viewport: sourcePage.viewportSize() ?? { width: 1280, height: 720 },
  })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('아이디').fill(account.loginId)
  await page.getByLabel('비밀번호').fill(account.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  return { context, page }
}

async function expectTransactionDraftAcrossWidths(page: Page, field: Locator, value: string) {
  const originalViewport = page.viewportSize()
  await field.focus()
  for (const width of [320, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 760 : 900 })
    await expect(field).toHaveValue(value)
    await expect(field).toBeFocused()
    await expect(page.getByLabel('거래 종류')).toHaveText('지출')
    expect(await hasPageOverflow(page)).toBe(false)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
  await expect(field).toHaveValue(value)
  await expect(field).toBeFocused()
  await expectTouchTarget(page.getByRole('button', { name: '변경 저장' }), '변경 저장')
}

async function attachConflictEvidence(
  testInfo: TestInfo,
  response: { status(): number; headers(): Record<string, string> },
  problem: { errorCode?: string; correlationId?: string },
) {
  await testInfo.attach('transaction-version-conflict', {
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

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}
