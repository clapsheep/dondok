import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { registerAndLogin } from './support/auth'

type Account = Awaited<ReturnType<typeof registerAndLogin>>

type Evidence = {
  runId: string
  console: Array<{ page: string; type: string; text: string }>
  pageErrors: Array<{ page: string; message: string }>
  network: Array<{ page: string; method: string; path: string; status: number; requestId: string | null }>
  expectedHttpErrors: Array<{ path: string; status: number }>
}

type CurrentLedger = {
  ledger: null | {
    ledgerId: string
    version: number
    members: Array<{ memberId: string; displayName: string; currentUser: boolean }>
  }
}

type SharedLedger = {
  owner: Account
  member: Account
  memberContext: BrowserContext
  memberPage: Page
}

type DeletionSeed = {
  ledgerId: string
  ledgerVersion: number
  ownerMemberId: string
  memberIds: string[]
  assetId: string
  assetName: string
  transactionId: string
  transactionDescription: string
  requestIds: string[]
}

type Problem = {
  status?: number
  errorCode?: string
  correlationId?: string
}

const evidenceByPage = new WeakMap<Page, Evidence>()

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }, testInfo) => {
  const runId = `ledger-deletion-${Date.now()}-${testInfo.workerIndex}-${Math.floor(Math.random() * 10_000)}`
  const evidence: Evidence = { runId, console: [], pageErrors: [], network: [], expectedHttpErrors: [] }
  evidenceByPage.set(page, evidence)
  await page.context().setExtraHTTPHeaders(e2eHeaders(runId, testInfo))
  trackPage(page, evidence, 'owner')
})

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByPage.get(page)
  if (!evidence) return

  await testInfo.attach('ledger-deletion-console', {
    body: Buffer.from(JSON.stringify({
      runId: evidence.runId,
      messages: evidence.console,
      pageErrors: evidence.pageErrors,
    }, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach('ledger-deletion-network', {
    body: Buffer.from(JSON.stringify({
      runId: evidence.runId,
      requests: evidence.network,
      expectedHttpErrors: evidence.expectedHttpErrors,
    }, null, 2)),
    contentType: 'application/json',
  })

  const unexpectedNetworkErrors = evidence.network.filter((request) => request.status >= 400
    && !evidence.expectedHttpErrors.some((expected) => expected.path === request.path && expected.status === request.status))
  const expectedConsoleStatuses = new Set(evidence.expectedHttpErrors.map((expected) => expected.status))
  const unexpectedConsoleErrors = evidence.console.filter((message) => {
    if (message.type !== 'error') return false
    const resourceStatus = message.text.match(/^Failed to load resource: the server responded with a status of (\d{3})/)
    return !resourceStatus || !expectedConsoleStatuses.has(Number(resourceStatus[1]))
  })

  expect(evidence.pageErrors, '가계부 삭제 흐름에 처리되지 않은 page error가 없어야 합니다').toEqual([])
  expect(unexpectedNetworkErrors, '선언하지 않은 API 4xx/5xx 응답이 없어야 합니다').toEqual([])
  expect(unexpectedConsoleErrors, '선언하지 않은 console error가 없어야 합니다').toEqual([])
})

test('확인 문구로 전체 삭제하면 두 구성원의 계정·세션은 유지되고 이전 데이터는 노출되지 않는다', async ({
  page,
  request,
  browser,
}, testInfo) => {
  const shared = await createSharedLedger(page, request, browser, testInfo, '삭제 성공')
  try {
    const seed = await seedDeletionLedger(page)
    await attachSeedManifest(testInfo, page, {
      flow: 'successful-deletion',
      ledgerId: seed.ledgerId,
      ledgerVersion: seed.ledgerVersion,
      memberIds: seed.memberIds,
      assetId: seed.assetId,
      transactionId: seed.transactionId,
      requestIds: seed.requestIds,
    })

    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
    const trigger = page.getByRole('button', { name: '가계부 삭제', exact: true })

    let dialog = await openDeletionDialog(page, trigger)
    const confirmation = dialog.getByLabel('확인 문구', { exact: true })
    const finalAction = dialog.getByRole('button', { name: '영구 삭제', exact: true })
    await confirmation.fill('가계부 삭')
    await expect(finalAction).toBeDisabled()
    await confirmation.fill('가계부 삭제 ')
    await expect(finalAction).toBeDisabled()
    await confirmation.fill('가계부 삭제')
    await expect(finalAction).toBeEnabled()
    await expectDeletionDialogLayout(page, dialog, confirmation, '가계부 삭제')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger, 'Escape로 닫으면 삭제 trigger로 focus가 돌아와야 합니다').toBeFocused()

    dialog = await openDeletionDialog(page, trigger)
    await dialog.getByLabel('확인 문구', { exact: true }).fill('가계부 삭제')
    await page.goBack()
    await expect(page).toHaveURL(/\/settings(?:\?|$)/)
    await expect(dialog).toBeHidden()
    await expect(trigger, '브라우저 뒤로가기로 닫으면 삭제 trigger로 focus가 돌아와야 합니다').toBeFocused()

    dialog = await openDeletionDialog(page, trigger)
    await dialog.getByLabel('확인 문구', { exact: true }).fill('가계부 삭제')
    const deletionResponsePromise = page.waitForResponse((response) => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === '/api/ledger-books/current')
    await dialog.getByRole('button', { name: '영구 삭제', exact: true }).click()
    const deletionResponse = await deletionResponsePromise
    expect(deletionResponse.status()).toBe(204)

    await expectNoLedgerHome(page)
    await expect(page.getByText(seed.assetName, { exact: true })).toHaveCount(0)
    await expect(page.getByText(seed.transactionDescription, { exact: true })).toHaveCount(0)

    allowExpectedHttpError(page, 404, `/api/assets/${seed.assetId}`)
    allowExpectedHttpError(page, 404, `/api/transactions/${seed.transactionId}`)
    const ownerState = await readDeletedLedgerState(page, seed.assetId, seed.transactionId)
    const memberState = await readDeletedLedgerState(shared.memberPage, seed.assetId, seed.transactionId)
    expectDeletedLedgerState(ownerState)
    expectDeletedLedgerState(memberState)
    await attachStateEvidence(testInfo, 'ledger-deletion-owner-state', ownerState)
    await attachStateEvidence(testInfo, 'ledger-deletion-member-state', memberState)

    await shared.memberPage.goto(`/assets/${seed.assetId}`)
    await expectNoLedgerHome(shared.memberPage)
    await expect(shared.memberPage.getByText(seed.assetName, { exact: true })).toHaveCount(0)
    await expect(shared.memberPage.getByText(seed.transactionDescription, { exact: true })).toHaveCount(0)

    await page.goto(`/transactions/${seed.transactionId}`)
    await expectNoLedgerHome(page)
    await expect(page.getByText(seed.transactionDescription, { exact: true })).toHaveCount(0)
  } finally {
    await shared.memberContext.close().catch(() => undefined)
  }
})

test('다른 구성원이 구조를 바꾸면 오래 열린 삭제를 412로 거부하고 확인 draft를 보존한다', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '동시성 계약은 독립 데스크톱 세션 한 조합으로 검증합니다.')

  const shared = await createSharedLedger(page, request, browser, testInfo, '삭제 충돌')
  try {
    const seed = await seedDeletionLedger(page)
    await page.goto('/settings')
    const trigger = page.getByRole('button', { name: '가계부 삭제', exact: true })
    let dialog = await openDeletionDialog(page, trigger)
    const confirmation = dialog.getByLabel('확인 문구', { exact: true })
    await confirmation.fill('가계부 삭제')

    const changed = await issueInvitation(shared.memberPage)
    expect(changed.current.ledger?.ledgerId).toBe(seed.ledgerId)
    expect(changed.current.ledger?.version).toBeGreaterThan(seed.ledgerVersion)

    allowExpectedHttpError(page, 412, '/api/ledger-books/current')
    const staleResponsePromise = page.waitForResponse((response) => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === '/api/ledger-books/current')
    await dialog.getByRole('button', { name: '영구 삭제', exact: true }).click()
    const staleResponse = await staleResponsePromise
    const problem = await staleResponse.json() as Problem
    expect(staleResponse.status()).toBe(412)
    expect(problem.status).toBe(412)
    expect(problem.errorCode).toBe('VERSION_CONFLICT')
    await attachConflictEvidence(testInfo, 'ledger-version-conflict', staleResponse, problem, {
      expectedLedgerId: seed.ledgerId,
      expectedVersion: seed.ledgerVersion,
      currentVersion: changed.current.ledger?.version,
      mutationRequestId: changed.requestId,
    })

    dialog = page.getByRole('dialog', { name: '가계부 삭제' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('확인 문구', { exact: true })).toHaveValue('가계부 삭제')
    const conflict = dialog.getByRole('alert').filter({ hasText: '가계부가 변경됐어요' })
    await expect(conflict).toBeVisible()
    await expect(conflict).toBeFocused()
    await expect(dialog.getByRole('button', { name: '영구 삭제', exact: true })).toHaveCount(0)
    await expect(conflict.getByRole('button', { name: '최신 내용 다시 확인' })).toHaveCount(1)

    const ownerBeforeRefresh = await readLedgerAndResources(page, seed.assetId, seed.transactionId)
    const memberBeforeRefresh = await readLedgerAndResources(shared.memberPage, seed.assetId, seed.transactionId)
    expectLedgerAndResourcesPreserved(ownerBeforeRefresh, seed.ledgerId)
    expectLedgerAndResourcesPreserved(memberBeforeRefresh, seed.ledgerId)

    const currentResponsePromise = page.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/ledger-books/current')
    await conflict.getByRole('button', { name: '최신 내용 다시 확인' }).click()
    expect((await currentResponsePromise).status()).toBe(200)
    dialog = page.getByRole('dialog', { name: '가계부 삭제' })
    await expect(dialog.getByLabel('확인 문구', { exact: true })).toHaveValue('가계부 삭제')
    await expect(dialog.getByRole('button', { name: '영구 삭제', exact: true })).toBeEnabled()
  } finally {
    await shared.memberContext.close().catch(() => undefined)
  }
})

test('이전 가계부와 같은 version의 새 가계부가 생겨도 expectedLedgerId로 ABA 삭제를 막는다', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'ABA 계약은 독립 데스크톱 세션 한 조합으로 검증합니다.')

  const shared = await createSharedLedger(page, request, browser, testInfo, '삭제 ABA')
  const secondaryOwner = await loginInIndependentContext(
    browser,
    page,
    shared.owner,
    testInfo,
    'owner-new-ledger',
  )
  try {
    const seed = await seedDeletionLedger(page)
    await page.goto('/settings')
    const dialog = await openDeletionDialog(page, page.getByRole('button', { name: '가계부 삭제', exact: true }))
    await dialog.getByLabel('확인 문구', { exact: true }).fill('가계부 삭제')

    const otherMemberCurrent = await readCurrentLedger(shared.memberPage)
    expect(otherMemberCurrent.ledger?.ledgerId).toBe(seed.ledgerId)
    const otherDelete = await deleteLedgerViaApi(shared.memberPage, {
      expectedLedgerId: seed.ledgerId,
      expectedVersion: otherMemberCurrent.ledger!.version,
      confirmationPhrase: '가계부 삭제',
    })
    expect(otherDelete.status).toBe(204)

    let recreated = await createLedgerViaApi(secondaryOwner.page)
    while (recreated.version < seed.ledgerVersion) {
      const mutation = await issueInvitation(secondaryOwner.page)
      recreated = mutation.current.ledger!
    }
    expect(recreated.ledgerId).not.toBe(seed.ledgerId)
    expect(recreated.version).toBe(seed.ledgerVersion)

    allowExpectedHttpError(page, 412, '/api/ledger-books/current')
    const abaResponsePromise = page.waitForResponse((response) => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === '/api/ledger-books/current')
    await dialog.getByRole('button', { name: '영구 삭제', exact: true }).click()
    const abaResponse = await abaResponsePromise
    const problem = await abaResponse.json() as Problem
    expect(abaResponse.status()).toBe(412)
    expect(problem.errorCode).toBe('VERSION_CONFLICT')
    await attachConflictEvidence(testInfo, 'ledger-aba-conflict', abaResponse, problem, {
      staleLedgerId: seed.ledgerId,
      currentLedgerId: recreated.ledgerId,
      equalVersion: recreated.version,
    })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('확인 문구', { exact: true })).toHaveValue('가계부 삭제')
    await expect(dialog.getByRole('alert').filter({ hasText: '가계부가 변경됐어요' })).toBeFocused()
    const currentAfterConflict = await readCurrentLedger(secondaryOwner.page)
    expect(currentAfterConflict.ledger?.ledgerId).toBe(recreated.ledgerId)
    expect(currentAfterConflict.ledger?.version).toBe(recreated.version)
    const recreatedAssets = await readJsonResponse(secondaryOwner.page, '/api/assets')
    expect(recreatedAssets.status).toBe(200)
    expect(Array.isArray(recreatedAssets.body)).toBe(true)
    expect(recreatedAssets.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: seed.assetId }),
    ]))
  } finally {
    await secondaryOwner.context.close().catch(() => undefined)
    await shared.memberContext.close().catch(() => undefined)
  }
})

async function createSharedLedger(
  page: Page,
  request: APIRequestContext,
  browser: Browser,
  testInfo: TestInfo,
  label: string,
): Promise<SharedLedger> {
  const owner = await registerAndLogin(page, request, `${label} 작성자 ${testInfo.workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const invitation = await issueInvitation(page)

  const member = await newIndependentPage(browser, page, testInfo, 'member')
  const memberAccount = await registerAndLogin(
    member.page,
    request,
    `${label} 구성원 ${testInfo.workerIndex}`,
  )
  await member.page.goto(`/join?code=${encodeURIComponent(invitation.code)}`)
  await expect(member.page.getByRole('heading', { name: '가계부 초대' })).toBeVisible()
  await member.page.getByRole('button', { name: '참여하기' }).click()
  await expect(member.page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const current = await readCurrentLedger(page)
  expect(current.ledger?.members).toHaveLength(2)

  return {
    owner,
    member: memberAccount,
    memberContext: member.context,
    memberPage: member.page,
  }
}

async function seedDeletionLedger(page: Page): Promise<DeletionSeed> {
  return page.evaluate(async () => {
    type Asset = { assetId: string; name: string; systemCode: string }
    type Category = { categoryId: string; systemCode: string | null }
    type Transaction = { transactionId: string }
    type Current = CurrentLedger

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
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          [csrf.headerName]: csrf.token,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`)
      const requestId = response.headers.get('X-Request-Id')
      if (requestId) requestIds.push(requestId)
      return response.json() as Promise<T>
    }

    const current = await requiredJson<Current>('/api/ledger-books/current')
    const assets = await requiredJson<Asset[]>('/api/assets')
    const categories = await requiredJson<Category[]>('/api/categories?kind=INCOME')
    const ledger = current.ledger
    const owner = ledger?.members.find((member) => member.currentUser)
    const account = assets.find((asset) => asset.systemCode === 'BANK')
    const income = categories.find((category) => category.systemCode === 'OTHER')
    if (!ledger || !owner || !account || !income) throw new Error('ledger deletion seed defaults were not found')

    const suffix = crypto.randomUUID().slice(0, 8)
    const description = `QC 삭제 전 수입 ${suffix}`
    const transaction = await mutate<Transaction>('/api/transactions', {
      type: 'INCOME',
      occurredOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
      amountWon: 123_456,
      categoryId: income.categoryId,
      assetId: account.assetId,
      performedByMemberId: owner.memberId,
      description,
    })
    const latest = await requiredJson<Current>('/api/ledger-books/current')
    return {
      ledgerId: latest.ledger!.ledgerId,
      ledgerVersion: latest.ledger!.version,
      ownerMemberId: owner.memberId,
      memberIds: latest.ledger!.members.map((member) => member.memberId),
      assetId: account.assetId,
      assetName: account.name,
      transactionId: transaction.transactionId,
      transactionDescription: description,
      requestIds,
    }
  })
}

async function issueInvitation(page: Page) {
  return page.evaluate(async () => {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' })
    if (!csrfResponse.ok) throw new Error(`/api/auth/csrf returned ${csrfResponse.status}`)
    const csrf = await csrfResponse.json() as { headerName: string; token: string }
    const response = await fetch('/api/ledger-books/current/invitations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
    })
    if (!response.ok) throw new Error(`/api/ledger-books/current/invitations returned ${response.status}`)
    const invitation = await response.json() as { code: string }
    const currentResponse = await fetch('/api/ledger-books/current', { credentials: 'include' })
    if (!currentResponse.ok) throw new Error(`/api/ledger-books/current returned ${currentResponse.status}`)
    return {
      code: invitation.code,
      requestId: response.headers.get('X-Request-Id'),
      current: await currentResponse.json() as CurrentLedger,
    }
  })
}

async function openDeletionDialog(page: Page, trigger: Locator) {
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '가계부 삭제' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('구성원')
  await expect(dialog).toContainText('자산')
  await expect(dialog).toContainText('기록')
  await expect(dialog).toContainText('초대')
  await expect(dialog).toContainText('계정')
  await expect(dialog).toContainText('로그인')
  return dialog
}

async function expectDeletionDialogLayout(
  page: Page,
  dialog: Locator,
  confirmation: Locator,
  draft: string,
) {
  const marker = `qc-ledger-deletion-${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  await dialog.evaluate((node, value) => node.setAttribute('data-qc-ledger-deletion', value), marker)
  await confirmation.focus()
  await expect(dialog).toHaveAttribute('data-qc-ledger-deletion', marker)
  await expect(confirmation).toHaveValue(draft)
  await expect(confirmation).toBeFocused()
  await expectTouchTarget(dialog.getByRole('button', { name: '영구 삭제', exact: true }), '영구 삭제')
  expect(await hasPageOverflow(page), '가계부 삭제 dialog에서 페이지 가로 overflow가 없어야 합니다').toBe(false)

  const bounds = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return {
      left: rect.left,
      right: innerWidth - rect.right,
      width: rect.width,
      internalOverflow: node.scrollWidth > node.clientWidth + 1,
      viewportWidth: innerWidth,
    }
  })
  expect(bounds.internalOverflow).toBe(false)
  if (bounds.viewportWidth < 768) {
    expect(bounds.left).toBeGreaterThanOrEqual(15)
    expect(bounds.right).toBeGreaterThanOrEqual(15)
  } else {
    expect(bounds.width).toBeLessThanOrEqual(610)
    expect(Math.abs(bounds.left - bounds.right)).toBeLessThanOrEqual(2)
  }
}

async function readDeletedLedgerState(page: Page, assetId: string, transactionId: string) {
  return page.evaluate(async ({ assetId, transactionId }) => {
    const read = async (path: string) => {
      const response = await fetch(path, { credentials: 'include' })
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null }
    }
    return {
      auth: await read('/api/auth/me'),
      current: await read('/api/ledger-books/current'),
      asset: await read(`/api/assets/${assetId}`),
      transaction: await read(`/api/transactions/${transactionId}`),
    }
  }, { assetId, transactionId })
}

function expectDeletedLedgerState(state: Awaited<ReturnType<typeof readDeletedLedgerState>>) {
  expect(state.auth.status).toBe(200)
  expect(state.current).toEqual({ status: 200, body: { ledger: null } })
  expect(state.asset.status).toBe(404)
  expect(state.asset.body).toEqual(expect.objectContaining({ status: 404, errorCode: 'LEDGER_NOT_FOUND' }))
  expect(state.transaction.status).toBe(404)
  expect(state.transaction.body).toEqual(expect.objectContaining({ status: 404, errorCode: 'LEDGER_NOT_FOUND' }))
}

async function readLedgerAndResources(page: Page, assetId: string, transactionId: string) {
  return page.evaluate(async ({ assetId, transactionId }) => {
    const read = async (path: string) => {
      const response = await fetch(path, { credentials: 'include' })
      return { status: response.status, body: await response.json() }
    }
    return {
      current: await read('/api/ledger-books/current'),
      asset: await read(`/api/assets/${assetId}`),
      transaction: await read(`/api/transactions/${transactionId}`),
    }
  }, { assetId, transactionId })
}

function expectLedgerAndResourcesPreserved(
  state: Awaited<ReturnType<typeof readLedgerAndResources>>,
  ledgerId: string,
) {
  expect(state.current.status).toBe(200)
  expect(state.current.body).toEqual(expect.objectContaining({ ledger: expect.objectContaining({ ledgerId }) }))
  expect(state.asset.status).toBe(200)
  expect(state.transaction.status).toBe(200)
}

async function readCurrentLedger(page: Page): Promise<CurrentLedger> {
  return page.evaluate(async () => {
    const response = await fetch('/api/ledger-books/current', { credentials: 'include' })
    if (!response.ok) throw new Error(`/api/ledger-books/current returned ${response.status}`)
    return response.json() as Promise<CurrentLedger>
  })
}

async function deleteLedgerViaApi(
  page: Page,
  body: { expectedLedgerId: string; expectedVersion: number; confirmationPhrase: '가계부 삭제' },
) {
  return page.evaluate(async (requestBody) => {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' })
    const csrf = await csrfResponse.json() as { headerName: string; token: string }
    const response = await fetch('/api/ledger-books/current', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
      body: JSON.stringify(requestBody),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, requestId: response.headers.get('X-Request-Id') }
  }, body)
}

async function createLedgerViaApi(page: Page) {
  return page.evaluate(async () => {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' })
    const csrf = await csrfResponse.json() as { headerName: string; token: string }
    const response = await fetch('/api/ledger-books', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
    })
    if (!response.ok) throw new Error(`/api/ledger-books returned ${response.status}: ${await response.text()}`)
    return response.json() as Promise<NonNullable<CurrentLedger['ledger']>>
  })
}

async function readJsonResponse(page: Page, path: string) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: 'include' })
    return { status: response.status, body: await response.json() as unknown }
  }, path)
}

async function expectNoLedgerHome(page: Page) {
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '초대 코드를 받으셨나요?' })).toBeVisible()
  await expect(page.getByRole('button', { name: '가계부 시작하기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '로그인' })).toHaveCount(0)
}

async function newIndependentPage(
  browser: Browser,
  sourcePage: Page,
  testInfo: TestInfo,
  label: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const evidence = evidenceByPage.get(sourcePage)
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL ?? process.env.BASE_URL ?? 'http://127.0.0.1:5173'),
    viewport: sourcePage.viewportSize() ?? { width: 1280, height: 720 },
    serviceWorkers: 'block',
    extraHTTPHeaders: e2eHeaders(evidence?.runId ?? `ledger-deletion-${Date.now()}`, testInfo),
  })
  const page = await context.newPage()
  if (evidence) {
    evidenceByPage.set(page, evidence)
    trackPage(page, evidence, label)
  }
  return { context, page }
}

async function loginInIndependentContext(
  browser: Browser,
  sourcePage: Page,
  account: Account,
  testInfo: TestInfo,
  label: string,
) {
  const independent = await newIndependentPage(browser, sourcePage, testInfo, label)
  await independent.page.goto('/login')
  await independent.page.getByLabel('아이디').fill(account.loginId)
  await independent.page.getByLabel('비밀번호').fill(account.password)
  await independent.page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(independent.page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  return independent
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
  if (!evidence) throw new Error('ledger deletion evidence was not initialized')
  evidence.expectedHttpErrors.push({ status, path })
}

function e2eHeaders(runId: string, testInfo: TestInfo) {
  return {
    'X-E2E-Run-Id': runId,
    'X-E2E-Test-Id': Buffer.from(testInfo.testId).toString('base64url'),
  }
}

async function attachSeedManifest(testInfo: TestInfo, page: Page, seed: Record<string, unknown>) {
  const evidence = evidenceByPage.get(page)
  await testInfo.attach('ledger-deletion-seed-manifest', {
    body: Buffer.from(JSON.stringify({
      runId: evidence?.runId,
      seedVersion: 'ledger-deletion-ui-v1',
      migrationVersion: 'V15',
      timezone: 'Asia/Seoul',
      ...seed,
    }, null, 2)),
    contentType: 'application/json',
  })
}

async function attachConflictEvidence(
  testInfo: TestInfo,
  name: string,
  response: { status(): number; headers(): Record<string, string> },
  problem: Problem,
  expected: Record<string, unknown>,
) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify({
      status: response.status(),
      errorCode: problem.errorCode,
      correlationId: problem.correlationId,
      requestId: response.headers()['x-request-id'],
      ...expected,
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

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}
