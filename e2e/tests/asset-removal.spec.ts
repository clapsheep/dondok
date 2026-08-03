import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { registerAndLogin } from './support/auth'

type Evidence = {
  runId: string
  console: Array<{ page: string; type: string; text: string }>
  pageErrors: Array<{ page: string; message: string }>
  network: Array<{ page: string; method: string; path: string; status: number; requestId: string | null }>
  expectedHttpErrors: Array<{ path: string; status: number }>
}

type AssetSeed = {
  ownerMemberId: string
  hardDeleteAssetId: string
  hardDeleteAssetName: string
  archiveAssetId: string
  archiveAssetName: string
  defaultAccountId: string
  defaultAccountName: string
  incomeTransactionId: string
  currentMonth: string
  netWorthWon: number
  incomeWon: number
  requestIds: string[]
}

type ConcurrencySeed = {
  assetId: string
  assetName: string
  ownerMemberId: string
  incomeCategoryId: string
  currentMonth: string
  requestIds: string[]
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
  const runId = `asset-removal-${Date.now()}-${testInfo.workerIndex}-${Math.floor(Math.random() * 10_000)}`
  const evidence: Evidence = { runId, console: [], pageErrors: [], network: [], expectedHttpErrors: [] }
  evidenceByPage.set(page, evidence)
  await page.context().setExtraHTTPHeaders(e2eHeaders(runId, testInfo))
  trackPage(page, evidence, 'owner')
})

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByPage.get(page)
  if (!evidence) return
  await testInfo.attach('asset-removal-console', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, messages: evidence.console, pageErrors: evidence.pageErrors }, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach('asset-removal-network', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, requests: evidence.network, expectedHttpErrors: evidence.expectedHttpErrors }, null, 2)),
    contentType: 'application/json',
  })
  const unexpectedNetworkErrors = evidence.network.filter((request) => request.status >= 400
    && !evidence.expectedHttpErrors.some((expected) => expected.path === request.path && expected.status === request.status))
  const expectedConsoleStatuses = new Set(evidence.expectedHttpErrors.map((expected) => expected.status))
  const unexpectedConsoleErrors = evidence.console.filter((message) => {
    if (message.type !== 'error') return false
    const browserResourceStatus = message.text.match(/^Failed to load resource: the server responded with a status of (\d{3})/)
    return !browserResourceStatus || !expectedConsoleStatuses.has(Number(browserResourceStatus[1]))
  })
  expect(evidence.pageErrors, '자산 정리 흐름에 처리되지 않은 page error가 없어야 합니다').toEqual([])
  expect(unexpectedNetworkErrors, '선언하지 않은 API 4xx/5xx 응답이 없어야 합니다').toEqual([])
  expect(unexpectedConsoleErrors, '선언하지 않은 console error가 없어야 합니다').toEqual([])
})

test('무이력 자산은 삭제하고 이력 자산은 보관해 순자산·통계·선택 범위를 유지한다', async ({ page, request }, testInfo) => {
  const account = await registerAndLogin(page, request, `자산 정리 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const seed = await seedAssetRemovalLedger(page)
  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'delete-archive-blocker',
    currentMonth: seed.currentMonth,
    ownerMemberId: seed.ownerMemberId,
    assets: {
      hardDelete: seed.hardDeleteAssetId,
      archive: seed.archiveAssetId,
      linkedAccount: seed.defaultAccountId,
    },
    transactions: { income: seed.incomeTransactionId },
    requestIds: seed.requestIds,
  })

  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expectAssetSummary(page, '순자산', formatWon(seed.netWorthWon))

  await page.goto(`/assets/${seed.hardDeleteAssetId}`)
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  const deleteTrigger = page.getByRole('button', { name: '정리 결과 확인' })
  await deleteTrigger.click()
  let dialog = page.getByRole('dialog', { name: '자산 완전 삭제' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('연결된 거래 이력', { exact: true }).locator('..')).toContainText('0건')
  await expect(dialog.getByText('거래 이력이 없어 이 자산을 완전히 삭제합니다.', { exact: false })).toBeVisible()
  await expectRemovalDialogAcrossViewports(page, dialog, '자산 완전 삭제')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(deleteTrigger).toBeFocused()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/assets/${seed.hardDeleteAssetId}`)

  await deleteTrigger.click()
  dialog = page.getByRole('dialog', { name: '자산 완전 삭제' })
  allowExpectedHttpError(page, 404, `/api/assets/${seed.hardDeleteAssetId}`)
  const hardDeleteResponse = page.waitForResponse((response) => response.request().method() === 'DELETE'
    && new URL(response.url()).pathname === `/api/assets/${seed.hardDeleteAssetId}`)
  await dialog.getByRole('button', { name: '자산 완전 삭제', exact: true }).click()
  const hardDeleteResultResponse = await hardDeleteResponse
  expect(hardDeleteResultResponse.status()).toBe(200)
  expect(await hardDeleteResultResponse.json()).toEqual(expect.objectContaining({
    assetId: seed.hardDeleteAssetId,
    name: seed.hardDeleteAssetName,
    disposition: 'DELETED',
    currentBalanceWon: 0,
  }))
  await expect(page.getByRole('status')).toContainText(`‘${seed.hardDeleteAssetName}’ 자산을 완전히 삭제했어요.`)
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()

  const hardDeleteState = await readAssetState(page, seed.hardDeleteAssetId)
  expect(hardDeleteState).toEqual({ detailStatus: 404, active: false, archived: false, all: false })
  await attachStateEvidence(testInfo, 'hard-delete-state', hardDeleteState)

  await page.goto(`/statistics?month=${seed.currentMonth}`)
  await expect(page.getByRole('heading', { name: '월간 통계', exact: true })).toBeVisible()
  await expectStatisticsValue(page, '수입', `+${formatWon(seed.incomeWon)}`)
  await expectStatisticsValue(page, '순액', `+${formatWon(seed.incomeWon)}`)

  await page.goto(`/assets/${seed.archiveAssetId}`)
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await page.getByRole('button', { name: '정리 결과 확인' }).click()
  dialog = page.getByRole('dialog', { name: '자산 보관' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('연결된 거래 이력', { exact: true }).locator('..')).toContainText('2건')
  await expect(dialog.getByText('현재 잔액', { exact: true }).locator('..')).toContainText(formatWon(seed.netWorthWon))
  await expect(dialog.getByRole('list', { name: '자산 정리 주의사항' })).toContainText('순자산에 계속 포함')
  const archiveResponse = page.waitForResponse((response) => response.request().method() === 'DELETE'
    && new URL(response.url()).pathname === `/api/assets/${seed.archiveAssetId}`)
  await dialog.getByRole('button', { name: '자산 보관', exact: true }).click()
  const archiveResultResponse = await archiveResponse
  expect(archiveResultResponse.status()).toBe(200)
  expect(await archiveResultResponse.json()).toEqual(expect.objectContaining({
    assetId: seed.archiveAssetId,
    name: seed.archiveAssetName,
    disposition: 'ARCHIVED',
    currentBalanceWon: seed.netWorthWon,
  }))

  await expect(page.getByRole('status')).toContainText(`‘${seed.archiveAssetName}’ 자산을 보관했어요.`)
  await expectAssetSummary(page, '순자산', formatWon(seed.netWorthWon))
  const archivedState = await readAssetState(page, seed.archiveAssetId)
  expect(archivedState).toEqual({ detailStatus: 200, active: false, archived: true, all: true })
  await attachStateEvidence(testInfo, 'archive-state', archivedState)

  const archivedDisclosure = page.getByText('보관 자산 1개', { exact: true })
  await archivedDisclosure.click()
  const archivedLink = page.getByRole('link').filter({ hasText: seed.archiveAssetName })
  await expect(archivedLink).toBeVisible()
  await expect(archivedLink).toContainText(formatWon(seed.netWorthWon))
  await archivedLink.click()
  await expect(page.getByRole('heading', { name: seed.archiveAssetName, exact: true })).toBeVisible()
  await expect(page.getByLabel('보관 자산 정보')).toContainText('현재 잔액 · 순자산 포함')
  await expect(page.getByRole('status')).toContainText('보관 자산은 읽기 전용이에요.')
  await expect(page.locator('form')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '변경 저장' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '자산 정리' })).toHaveCount(0)

  await page.goto('/transactions/new')
  await expect(page.getByRole('heading', { name: '거래 기록' })).toBeVisible()
  await page.getByRole('button', { name: '수입', exact: true }).click()
  await expect(page.getByLabel('입금 자산')).not.toContainText(seed.archiveAssetName)

  await page.goto(`/statistics?month=${seed.currentMonth}`)
  await expect(page.getByRole('heading', { name: '월간 통계', exact: true })).toBeVisible()
  await expectStatisticsValue(page, '수입', `+${formatWon(seed.incomeWon)}`)
  await expectStatisticsValue(page, '순액', `+${formatWon(seed.incomeWon)}`)

  await page.goto(`/assets/${seed.defaultAccountId}`)
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  const blockerTrigger = page.getByRole('button', { name: '정리 결과 확인' })
  await blockerTrigger.click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '먼저 연결을 변경해 주세요' })).toBeVisible()
  await expect(dialog.getByText('신용카드 결제 계좌 · 설정 열기', { exact: true })).toBeVisible()
  await expect(dialog.getByText('체크카드 결제 계좌 · 설정 열기', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '자산 완전 삭제', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '자산 보관', exact: true })).toHaveCount(0)
  await expectTouchTarget(dialog.getByRole('button', { name: '취소' }), 'blocker 취소')
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(blockerTrigger).toBeFocused()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/assets/${seed.defaultAccountId}`)
  expect(await hasPageOverflow(page)).toBe(false)
})

test('다른 세션이 preview 뒤 이력을 만들면 412로 거부하고 draft를 보존해 최신 결과를 재확인한다', async ({ page, request, browser }, testInfo) => {
  const account = await registerAndLogin(page, request, `자산 정리 경합 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const seed = await seedConcurrencyAsset(page)
  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'stale-removal-preview',
    currentMonth: seed.currentMonth,
    ownerMemberId: seed.ownerMemberId,
    assets: { stalePreview: seed.assetId },
    requestIds: seed.requestIds,
  })

  await page.goto(`/assets/${seed.assetId}`)
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  const memoDraft = `저장하지 않은 자산 메모 ${Date.now().toString().slice(-6)}`
  await page.getByLabel('메모 (선택)', { exact: true }).fill(memoDraft)
  await page.getByRole('button', { name: '정리 결과 확인' }).click()
  let dialog = page.getByRole('dialog', { name: '자산 완전 삭제' })
  await expect(dialog.getByText('연결된 거래 이력', { exact: true }).locator('..')).toContainText('0건')

  const other = await loginInIndependentContext(browser, page, account, testInfo)
  const evidence = evidenceByPage.get(page)
  if (evidence) trackPage(other.page, evidence, 'concurrent-writer')
  try {
    const transaction = await createIncomeInOtherSession(other.page, seed, 130_000)
    await testInfo.attach('asset-removal-concurrent-write', {
      body: Buffer.from(JSON.stringify({ assetId: seed.assetId, transactionId: transaction.transactionId, requestId: transaction.requestId }, null, 2)),
      contentType: 'application/json',
    })

    allowExpectedHttpError(page, 412, `/api/assets/${seed.assetId}`)
    const staleResponsePromise = page.waitForResponse((response) => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/assets/${seed.assetId}`)
    await dialog.getByRole('button', { name: '자산 완전 삭제', exact: true }).click()
    const staleResponse = await staleResponsePromise
    const problem = await staleResponse.json() as { status?: number; errorCode?: string; correlationId?: string }
    expect(staleResponse.status()).toBe(412)
    expect(problem.status).toBe(412)
    expect(problem.errorCode).toBe('ASSET_REMOVAL_PREVIEW_STALE')
    await attachConflictEvidence(testInfo, staleResponse, problem)

    dialog = page.getByRole('dialog', { name: '자산 완전 삭제' })
    const staleAlert = dialog.getByRole('alert').filter({ hasText: '정리 결과가 달라졌어요' })
    await expect(staleAlert).toBeVisible()
    await expect(staleAlert).toBeFocused()
    await expect(page.getByLabel('메모 (선택)', { exact: true })).toHaveValue(memoDraft)
    await expect(dialog.getByRole('button', { name: '자산 완전 삭제', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '자산 보관', exact: true })).toHaveCount(0)
    const refresh = staleAlert.getByRole('button', { name: '최신 내용 다시 확인' })
    await expectTouchTarget(refresh, '최신 내용 다시 확인')

    const previewResponsePromise = page.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/api/assets/${seed.assetId}/removal-preview`)
    await refresh.click()
    expect((await previewResponsePromise).status()).toBe(200)
    dialog = page.getByRole('dialog', { name: '자산 보관' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('연결된 거래 이력', { exact: true }).locator('..')).toContainText('1건')
    await expect(dialog.getByText('현재 잔액', { exact: true }).locator('..')).toContainText('130,000원')
    await expect(page.getByLabel('메모 (선택)', { exact: true })).toHaveValue(memoDraft)
    await expect(dialog.getByRole('button', { name: '자산 보관', exact: true })).toBeVisible()

    await expectRemovalDialogAcrossViewports(page, dialog, '자산 보관')
    const archiveResponsePromise = page.waitForResponse((response) => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/assets/${seed.assetId}`)
    await dialog.getByRole('button', { name: '자산 보관', exact: true }).click()
    expect((await archiveResponsePromise).status()).toBe(200)
    await expect(page.getByRole('status')).toContainText(`‘${seed.assetName}’ 자산을 보관했어요.`)
    expect(await readAssetState(page, seed.assetId)).toEqual({ detailStatus: 200, active: false, archived: true, all: true })
  } finally {
    await other.context.close().catch(() => undefined)
  }
})

async function seedAssetRemovalLedger(page: Page): Promise<AssetSeed> {
  const currentMonth = monthInSeoul()
  return page.evaluate(async ({ currentMonth }) => {
    type Member = { memberId: string; currentUser: boolean }
    type Asset = { assetId: string; assetTypeId: string; systemCode: string; name: string; currentBalanceWon: number }
    type AssetType = { assetTypeId: string; systemCode: string }
    type Category = { categoryId: string; systemCode: string | null }
    type Transaction = { transactionId: string }
    type Statistics = { totals: { incomeWon: number } }
    const requestIds: string[] = []
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      const requestId = response.headers.get('X-Request-Id')
      if (requestId) requestIds.push(requestId)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const mutate = async <T,>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(path, {
        method: 'POST', credentials: 'include',
        headers: {
          'Accept': 'application/json', 'Content-Type': 'application/json',
          [csrf.headerName]: csrf.token, 'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`)
      const requestId = response.headers.get('X-Request-Id')
      if (requestId) requestIds.push(requestId)
      return response.json() as Promise<T>
    }
    const current = await requiredJson<{ ledger: { members: Member[] } }>('/api/ledger-books/current')
    const assets = await requiredJson<Asset[]>('/api/assets')
    const assetTypes = await requiredJson<AssetType[]>('/api/asset-types')
    const incomeCategories = await requiredJson<Category[]>('/api/categories?kind=INCOME')
    const owner = current.ledger.members.find((member) => member.currentUser)
    const bankType = assetTypes.find((type) => type.systemCode === 'BANK')
    const defaultAccount = assets.find((asset) => asset.systemCode === 'BANK')
    const incomeCategory = incomeCategories.find((category) => category.systemCode === 'OTHER')
    if (!owner || !bankType || !defaultAccount || !incomeCategory) throw new Error('asset removal seed defaults were not found')
    const suffix = crypto.randomUUID().slice(0, 8)
    const assetBody = (name: string, openingBalanceWon: number) => ({
      assetTypeId: bankType.assetTypeId,
      ownershipScope: 'PERSONAL',
      ownerMemberId: owner.memberId,
      name,
      openedOn: `${currentMonth}-01`,
      memo: null,
      openingBalanceWon,
      cardSettings: null,
      debitCardSettings: null,
      savingsSettings: null,
    })
    const hardDeleteAsset = await mutate<Asset>('/api/assets', assetBody(`QC 무이력 계좌 ${suffix}`, 0))
    const archiveAsset = await mutate<Asset>('/api/assets', assetBody(`QC 이력 계좌 ${suffix}`, 500_000))
    const income = await mutate<Transaction>('/api/transactions', {
      type: 'INCOME', occurredOn: `${currentMonth}-12`, amountWon: 200_000,
      categoryId: incomeCategory.categoryId, assetId: archiveAsset.assetId,
      performedByMemberId: owner.memberId, description: `QC 자산 정리 수입 ${suffix}`,
    })
    const detail = await requiredJson<Asset>(`/api/assets/${archiveAsset.assetId}`)
    const statistics = await requiredJson<Statistics>(`/api/statistics/monthly?month=${encodeURIComponent(currentMonth)}`)
    return {
      ownerMemberId: owner.memberId,
      hardDeleteAssetId: hardDeleteAsset.assetId,
      hardDeleteAssetName: hardDeleteAsset.name,
      archiveAssetId: archiveAsset.assetId,
      archiveAssetName: archiveAsset.name,
      defaultAccountId: defaultAccount.assetId,
      defaultAccountName: defaultAccount.name,
      incomeTransactionId: income.transactionId,
      currentMonth,
      netWorthWon: detail.currentBalanceWon,
      incomeWon: statistics.totals.incomeWon,
      requestIds,
    }
  }, { currentMonth })
}

async function seedConcurrencyAsset(page: Page): Promise<ConcurrencySeed> {
  const currentMonth = monthInSeoul()
  return page.evaluate(async ({ currentMonth }) => {
    type Member = { memberId: string; currentUser: boolean }
    type AssetType = { assetTypeId: string; systemCode: string }
    type Category = { categoryId: string; systemCode: string | null }
    type Asset = { assetId: string; name: string }
    const requestIds: string[] = []
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      const requestId = response.headers.get('X-Request-Id')
      if (requestId) requestIds.push(requestId)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const current = await requiredJson<{ ledger: { members: Member[] } }>('/api/ledger-books/current')
    const types = await requiredJson<AssetType[]>('/api/asset-types')
    const categories = await requiredJson<Category[]>('/api/categories?kind=INCOME')
    const owner = current.ledger.members.find((member) => member.currentUser)
    const bank = types.find((type) => type.systemCode === 'BANK')
    const income = categories.find((category) => category.systemCode === 'OTHER')
    if (!owner || !bank || !income) throw new Error('asset concurrency seed defaults were not found')
    const response = await fetch('/api/assets', {
      method: 'POST', credentials: 'include',
      headers: {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        [csrf.headerName]: csrf.token, 'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        assetTypeId: bank.assetTypeId, ownershipScope: 'PERSONAL', ownerMemberId: owner.memberId,
        name: `QC 경합 계좌 ${crypto.randomUUID().slice(0, 8)}`, openedOn: `${currentMonth}-01`, memo: null,
        openingBalanceWon: 0, cardSettings: null, debitCardSettings: null, savingsSettings: null,
      }),
    })
    if (!response.ok) throw new Error(`/api/assets returned ${response.status}: ${await response.text()}`)
    const requestId = response.headers.get('X-Request-Id')
    if (requestId) requestIds.push(requestId)
    const asset = await response.json() as Asset
    return {
      assetId: asset.assetId,
      assetName: asset.name,
      ownerMemberId: owner.memberId,
      incomeCategoryId: income.categoryId,
      currentMonth,
      requestIds,
    }
  }, { currentMonth })
}

async function createIncomeInOtherSession(page: Page, seed: ConcurrencySeed, amountWon: number) {
  return page.evaluate(async ({ seed, amountWon }) => {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' })
    if (!csrfResponse.ok) throw new Error(`/api/auth/csrf returned ${csrfResponse.status}`)
    const csrf = await csrfResponse.json() as { headerName: string; token: string }
    const response = await fetch('/api/transactions', {
      method: 'POST', credentials: 'include',
      headers: {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        [csrf.headerName]: csrf.token, 'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        type: 'INCOME', occurredOn: `${seed.currentMonth}-13`, amountWon,
        categoryId: seed.incomeCategoryId, assetId: seed.assetId,
        performedByMemberId: seed.ownerMemberId, description: `QC preview 이후 수입 ${crypto.randomUUID().slice(0, 6)}`,
      }),
    })
    if (!response.ok) throw new Error(`/api/transactions returned ${response.status}: ${await response.text()}`)
    const transaction = await response.json() as { transactionId: string }
    return { transactionId: transaction.transactionId, requestId: response.headers.get('X-Request-Id') }
  }, { seed, amountWon })
}

async function readAssetState(page: Page, assetId: string) {
  return page.evaluate(async (assetId) => {
    type Asset = { assetId: string }
    const list = async (status: 'ACTIVE' | 'ARCHIVED' | 'ALL') => {
      const path = status === 'ACTIVE' ? '/api/assets' : `/api/assets?status=${status}`
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<Asset[]>
    }
    const [detail, active, archived, all] = await Promise.all([
      fetch(`/api/assets/${assetId}`, { credentials: 'include' }),
      list('ACTIVE'), list('ARCHIVED'), list('ALL'),
    ])
    return {
      detailStatus: detail.status,
      active: active.some((asset) => asset.assetId === assetId),
      archived: archived.some((asset) => asset.assetId === assetId),
      all: all.some((asset) => asset.assetId === assetId),
    }
  }, assetId)
}

async function expectRemovalDialogAcrossViewports(page: Page, dialog: Locator, finalAction: '자산 완전 삭제' | '자산 보관') {
  const marker = `qc-${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  await dialog.evaluate((node, value) => { node.setAttribute('data-qc-removal-dialog', value) }, marker)
  const close = dialog.getByRole('button', { name: '자산 정리 닫기' })
  await close.focus()
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(dialog, `${viewport.label}에서 같은 dialog가 유지되어야 합니다`).toHaveAttribute('data-qc-removal-dialog', marker)
    await expect(close, `${viewport.label}에서 dialog focus가 유지되어야 합니다`).toBeFocused()
    await expect(dialog.getByRole('button', { name: finalAction, exact: true })).toBeVisible()
    await expectTouchTarget(close, `${viewport.label} dialog 닫기`)
    await expectTouchTarget(dialog.getByRole('button', { name: finalAction, exact: true }), `${viewport.label} ${finalAction}`)
    const bounds = await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        left: rect.left, right: innerWidth - rect.right, width: rect.width,
        horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
      }
    })
    expect(bounds.horizontalOverflow, `${viewport.label} dialog 내부 가로 overflow`).toBe(false)
    expect(await hasPageOverflow(page), `${viewport.label} 페이지 가로 overflow`).toBe(false)
    if (viewport.width < 768) {
      expect(bounds.left, `${viewport.label} dialog 왼쪽 여백`).toBeGreaterThanOrEqual(15)
      expect(bounds.right, `${viewport.label} dialog 오른쪽 여백`).toBeGreaterThanOrEqual(15)
    } else {
      expect(bounds.width, `${viewport.label} dialog 최대 폭`).toBeLessThanOrEqual(610)
      expect(Math.abs(bounds.left - bounds.right), `${viewport.label} dialog 중앙 정렬`).toBeLessThanOrEqual(2)
    }
  }
}

async function expectAssetSummary(page: Page, label: string, value: string) {
  const term = page.getByRole('term').filter({ hasText: label }).first()
  await expect(term).toBeVisible()
  await expect(term.locator('..').getByText(value, { exact: true })).toBeVisible()
}

async function expectStatisticsValue(page: Page, label: string, value: string) {
  const summary = page.getByLabel('월간 수입 지출 순액 요약')
  await expect(summary.getByText(label, { exact: true }).locator('..').getByText(value, { exact: true })).toBeVisible()
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
    extraHTTPHeaders: e2eHeaders(evidence?.runId ?? `asset-removal-${Date.now()}`, testInfo),
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

function allowExpectedHttpError(page: Page, status: number, path: string) {
  const evidence = evidenceByPage.get(page)
  if (!evidence) throw new Error('asset removal evidence was not initialized')
  evidence.expectedHttpErrors.push({ status, path })
}

function e2eHeaders(runId: string, testInfo: TestInfo) {
  return {
    'X-E2E-Run-Id': runId,
    'X-E2E-Test-Id': Buffer.from(testInfo.testId).toString('base64url'),
  }
}

async function attachSeedManifest(testInfo: TestInfo, page: Page, loginId: string, seed: Record<string, unknown>) {
  const evidence = evidenceByPage.get(page)
  await testInfo.attach('asset-removal-seed-manifest', {
    body: Buffer.from(JSON.stringify({
      runId: evidence?.runId,
      seedVersion: 'asset-removal-ui-v1',
      migrationVersion: 'V15',
      loginId,
      timezone: 'Asia/Seoul',
      ...seed,
    }, null, 2)),
    contentType: 'application/json',
  })
}

async function attachConflictEvidence(
  testInfo: TestInfo,
  response: { status(): number; headers(): Record<string, string> },
  problem: { status?: number; errorCode?: string; correlationId?: string },
) {
  await testInfo.attach('asset-removal-preview-conflict', {
    body: Buffer.from(JSON.stringify({
      status: response.status(),
      problemStatus: problem.status,
      errorCode: problem.errorCode,
      correlationId: problem.correlationId,
      requestId: response.headers()['x-request-id'],
    }, null, 2)),
    contentType: 'application/json',
  })
}

async function attachStateEvidence(testInfo: TestInfo, name: string, state: Record<string, unknown>) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(state, null, 2)),
    contentType: 'application/json',
  })
}

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} 조작 영역이 보여야 합니다`).not.toBeNull()
  expect(box!.width, `${label} 조작 영역 너비`).toBeGreaterThanOrEqual(44)
  expect(box!.height, `${label} 조작 영역 높이`).toBeGreaterThanOrEqual(44)
}

function monthInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
}

function formatWon(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`
}

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}
