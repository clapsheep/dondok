import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { registerAndLogin } from './support/auth'

type Evidence = {
  runId: string
  console: Array<{ type: string; text: string }>
  pageErrors: string[]
  network: Array<{ method: string; path: string; status: number; requestId: string | null }>
}

type MonthlyStatistics = {
  month: string
  periodStart: string
  periodEndExclusive: string
  appliedFilters: {
    performedByMemberId: string | null
    assetOwnerType: 'ALL' | 'JOINT' | 'MEMBER'
    assetOwnerMemberId: string | null
    categoryId: string | null
  }
  totals: { incomeWon: number; expenseWon: number; netWon: number }
  categoryBreakdown: Array<{
    categoryId: string
    categoryName: string
    kind: 'INCOME' | 'EXPENSE'
    amountWon: number
  }>
  yearlyTrend: Array<{ month: string; incomeWon: number; expenseWon: number; netWon: number }>
}

type StatisticsSeed = {
  ownerLoginId: string
  ownerMemberId: string
  otherMemberId: string
  otherMemberName: string
  jointAssetId: string
  cardAssetId: string
  foodCategoryId: string
  currentMonth: string
  previousMonth: string
  includedTransactionIds: string[]
  excludedTransactionIds: string[]
  requestIds: string[]
  initialStatistics: MonthlyStatistics
}

const evidenceByPage = new WeakMap<Page, Evidence>()
const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568, label: '320px 모바일' },
  { width: 390, height: 844, label: '390px 모바일' },
  { width: 768, height: 1024, label: 'iPad 세로' },
  { width: 1024, height: 768, label: 'iPad 가로' },
  { width: 1280, height: 900, label: '데스크톱' },
] as const

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }, testInfo) => {
  const runId = `statistics-${Date.now()}-${testInfo.workerIndex}-${Math.floor(Math.random() * 10_000)}`
  const evidence: Evidence = { runId, console: [], pageErrors: [], network: [] }
  evidenceByPage.set(page, evidence)
  await page.context().setExtraHTTPHeaders({
    'X-E2E-Run-Id': runId,
    'X-E2E-Test-Id': Buffer.from(testInfo.testId).toString('base64url'),
  })
  page.on('console', (message) => evidence.console.push({ type: message.type(), text: message.text() }))
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/')) return
    evidence.network.push({
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
      requestId: response.headers()['x-request-id'] ?? null,
    })
  })
})

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByPage.get(page)
  if (!evidence) return
  await testInfo.attach('statistics-console', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, messages: evidence.console, pageErrors: evidence.pageErrors }, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach('statistics-network', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, requests: evidence.network }, null, 2)),
    contentType: 'application/json',
  })
})

test('공동 월간 통계는 환불 signed 금액과 AND 필터를 URL·반응형 상태로 유지한다', async ({ page, request }, testInfo) => {
  const seed = await createSharedStatisticsFixture(page, request)
  await attachSeedManifest(testInfo, page, seed)

  expect(seed.initialStatistics.month).toBe(seed.currentMonth)
  expect(seed.initialStatistics.periodStart).toBe(`${seed.currentMonth}-01`)
  expect(seed.initialStatistics.totals).toEqual({ incomeWon: 600_000, expenseWon: -180_000, netWon: 780_000 })
  expect(seed.initialStatistics.yearlyTrend).toHaveLength(12)
  expect(seed.initialStatistics.yearlyTrend.find((month) => month.month === seed.currentMonth)).toEqual({
    month: seed.currentMonth,
    incomeWon: 600_000,
    expenseWon: -180_000,
    netWon: 780_000,
  })
  expect(seed.initialStatistics.categoryBreakdown).toEqual(expect.arrayContaining([
    expect.objectContaining({ categoryName: '기타 수입', kind: 'INCOME', amountWon: 600_000 }),
    expect.objectContaining({ categoryName: '식비', kind: 'EXPENSE', amountWon: -220_000 }),
    expect.objectContaining({ categoryName: '교통비', kind: 'EXPENSE', amountWon: 40_000 }),
  ]))

  const statisticsRequests: string[] = []
  const transactionListRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/statistics/monthly') statisticsRequests.push(url.toString())
    if (request.method() === 'GET' && url.pathname === '/api/transactions') transactionListRequests.push(url.toString())
  })
  await page.goto('/statistics')
  await expect(page.getByRole('heading', { name: '월간 통계', exact: true })).toBeVisible()
  await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(seed.currentMonth)
  await expectCoreNavigation(page)
  await expectStatisticsSummary(page, { income: '+600,000원', expense: '+180,000원', net: '+780,000원' })

  const expenseCategories = page.getByRole('list', { name: '지출 분류 비중' })
  await expectCategoryAmount(expenseCategories, '식비', '+220,000원')
  await expectCategoryAmount(expenseCategories, '교통비', '-40,000원')
  await expect(page.getByText('환불을 반영해 비율 대신 분류별 순금액을 보여드려요', { exact: true })).toBeVisible()
  await expect(expenseCategories.getByText(/%$/)).toHaveCount(0)
  await expect(page.getByRole('img', { name: '지출 분류 비중 원형 차트' })).toHaveCount(0)

  const year = seed.currentMonth.slice(0, 4)
  const yearlyChart = page.getByRole('img', { name: `${year}년 월별 수입 지출 막대그래프` })
  await expect(yearlyChart).toBeVisible()
  await expect(yearlyChart.locator('[data-month-bar-group]')).toHaveCount(12)
  const selectedMonthBars = yearlyChart.locator(`[data-month-bar-group="${seed.currentMonth}"]`)
  await expect(selectedMonthBars.locator('[data-income-bar]')).toHaveAttribute('title', `${Number(seed.currentMonth.slice(5))}월 수입 +600,000원`)
  await expect(selectedMonthBars.locator('[data-expense-bar]')).toHaveAttribute('title', `${Number(seed.currentMonth.slice(5))}월 지출 +180,000원`)
  const yearlyDisclosure = page.getByText('월별 금액 목록', { exact: true })
  await expectTouchTarget(yearlyDisclosure, '월별 금액 목록')
  await yearlyDisclosure.click()
  const yearlyList = page.getByRole('list', { name: `${year}년 월별 금액 목록` })
  await expect(yearlyList.locator('time')).toHaveCount(12)
  const selectedMonthRow = yearlyList.locator(`time[datetime="${seed.currentMonth}"]`).locator('..')
  await expectLabeledValue(selectedMonthRow, '수입', '+600,000원')
  await expectLabeledValue(selectedMonthRow, '지출', '+180,000원')
  expect(statisticsRequests.length).toBeGreaterThan(0)
  expect(statisticsRequests.every((url) => !new URL(url).searchParams.has('from'))).toBe(true)
  expect(transactionListRequests).toHaveLength(0)

  const incomeDirection = page.getByRole('group', { name: '분류 비중 방향' }).getByRole('button', { name: '수입', exact: true })
  await incomeDirection.click()
  await expect(incomeDirection).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('direction')).toBe('income')
  await expectCategoryAmount(page.getByRole('list', { name: '수입 분류 비중' }), '기타 수입', '+600,000원')
  const categoryChart = page.getByRole('img', { name: '수입 분류 비중 원형 차트' })
  await expect(categoryChart).toBeVisible()
  const categorySlices = categoryChart.locator('[data-category-donut-slice]')
  await expect(categorySlices).toHaveCount(1)
  await expect(categorySlices.first()).toHaveAttribute('stroke', 'var(--chart-1)')
  await expect(categorySlices.first()).not.toHaveAttribute('stroke-opacity', /.+/)
  await expect(page.getByRole('list', { name: '수입 분류 비중' }).locator('[data-category-tone]')).toHaveAttribute('style', /var\(--chart-1\)/)
  const categoryPalette = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return Array.from({ length: 6 }, (_, index) => root.getPropertyValue(`--chart-${index + 1}`).trim())
  })
  expect(new Set(categoryPalette).size, '분류 팔레트 여섯 색은 서로 구별되어야 합니다').toBe(6)
  expect(categoryPalette.every(Boolean), '분류 팔레트 토큰은 모두 정의되어야 합니다').toBe(true)
  await expectResponsiveStatisticsState(page, incomeDirection, seed.currentMonth)

  await expect(page.getByRole('button', { name: '공동 전체, 통계 필터 열기' })).toBeVisible()
  // Base UI modal은 열린 동안 배경 trigger를 접근성 트리에서 숨긴다. aria-expanded와 focus 복원은 고정 id로 추적한다.
  const filterTrigger = page.locator('#statistics-filter-trigger')
  await expect(filterTrigger).toHaveAttribute('aria-expanded', 'false')
  await expectTouchTarget(filterTrigger, '통계 필터')
  await filterTrigger.click()
  await expect(filterTrigger).toHaveAttribute('aria-expanded', 'true')
  let filterDialog = page.getByRole('dialog', { name: '통계 필터' })
  await expect(filterDialog).toBeVisible()
  await expectFilterContract(filterDialog)
  await page.goBack()
  await expect(filterDialog).toHaveCount(0)
  await expect(filterTrigger).toBeFocused()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/statistics')

  await filterTrigger.click()
  filterDialog = page.getByRole('dialog', { name: '통계 필터' })
  await page.keyboard.press('Escape')
  await expect(filterDialog).toHaveCount(0)
  await expect(filterTrigger).toBeFocused()

  await filterTrigger.click()
  filterDialog = page.getByRole('dialog', { name: '통계 필터' })
  const memberRadio = filterDialog.getByRole('group', { name: '구성원' }).getByRole('radio', { name: seed.otherMemberName, exact: true })
  const jointRadio = filterDialog.getByRole('group', { name: '자산 소유자' }).getByRole('radio', { name: '공동 소유', exact: true })
  const foodRadio = filterDialog.getByRole('group', { name: '분류' }).getByRole('radio', { name: '식비 · 지출', exact: true })
  await memberRadio.check()
  await jointRadio.check()
  await foodRadio.check()
  await foodRadio.focus()
  await expectFilterDraftAcrossRotation(page, { memberRadio, jointRadio, foodRadio })
  expect(new URL(page.url()).searchParams.has('member')).toBe(false)
  await expectStatisticsSummary(page, { income: '+600,000원', expense: '+180,000원', net: '+780,000원' })

  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname === '/api/statistics/monthly'
      && url.searchParams.get('performedByMemberId') === seed.otherMemberId
      && url.searchParams.get('assetOwnerType') === 'JOINT'
      && url.searchParams.get('categoryId') === seed.foodCategoryId
  })
  await filterDialog.getByRole('button', { name: '필터 적용' }).click()
  expect((await filteredResponse).status()).toBe(200)
  await expect(page.getByText(/필터 3개 적용됨$/)).toBeVisible()
  await expect.poll(() => new URL(page.url()).searchParams.get('member')).toBe(seed.otherMemberId)
  expect(new URL(page.url()).searchParams.get('owner')).toBe('joint')
  expect(new URL(page.url()).searchParams.get('category')).toBe(seed.foodCategoryId)
  expect(new URL(page.url()).searchParams.has('direction')).toBe(false)
  await expectStatisticsSummary(page, { income: '0원', expense: '-30,000원', net: '-30,000원' })
  await expect(page.getByRole('button', { name: /필터 3개, 통계 필터 열기$/ })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '월간 통계', exact: true })).toBeVisible()
  await expectStatisticsSummary(page, { income: '0원', expense: '-30,000원', net: '-30,000원' })
  await expect(page.getByRole('group', { name: '분류 비중 방향' }).getByRole('button', { name: '지출', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '이전 달' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(seed.previousMonth)
  expect(new URL(page.url()).searchParams.get('member')).toBe(seed.otherMemberId)
  expect(new URL(page.url()).searchParams.get('owner')).toBe('joint')
  expect(new URL(page.url()).searchParams.get('category')).toBe(seed.foodCategoryId)
  await expect(page.getByText('선택한 조건에 맞는 기록이 없습니다', { exact: true })).toBeVisible()
  await expectTouchTarget(page.getByRole('button', { name: '이번 달' }), '이번 달')
  await page.getByRole('button', { name: '이번 달' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(seed.currentMonth)

  await page.getByRole('button', { name: /필터 3개, 통계 필터 열기$/ }).click()
  filterDialog = page.getByRole('dialog', { name: '통계 필터' })
  await expectTouchTarget(filterDialog.getByRole('button', { name: '필터 초기화' }), '필터 초기화')
  await filterDialog.getByRole('button', { name: '필터 초기화' }).click()
  await expect(filterDialog.getByRole('group', { name: '구성원' }).getByRole('radio', { name: '전체', exact: true })).toBeChecked()
  await expect(filterDialog.getByRole('group', { name: '자산 소유자' }).getByRole('radio', { name: '전체', exact: true })).toBeChecked()
  await expect(filterDialog.getByRole('group', { name: '분류' }).getByRole('radio', { name: '전체', exact: true })).toBeChecked()
  await filterDialog.getByRole('button', { name: '필터 적용' }).click()
  await expectStatisticsSummary(page, { income: '+600,000원', expense: '+180,000원', net: '+780,000원' })

  const settings = page.getByRole('link', { name: '설정', exact: true })
  await expect(settings).toBeVisible()
  await expect(primaryNavigation(page).getByRole('link', { name: '설정', exact: true })).toHaveCount(0)
  await settings.click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  expect(await hasPageOverflow(page)).toBe(false)
})

test('분류 원형 차트는 수입·지출 의미색과 분리된 여섯 색으로 항목을 구분한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `통계 팔레트 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  const month = monthInSeoul()
  const amounts = [60_000, 50_000, 40_000, 30_000, 20_000, 10_000]
  const categoryBreakdown: MonthlyStatistics['categoryBreakdown'] = amounts.map((amountWon, index) => ({
    categoryId: `palette-${index + 1}`,
    categoryName: `수입 분류 ${index + 1}`,
    kind: 'INCOME',
    amountWon,
  }))
  const monthlyStatistics: MonthlyStatistics = {
    month,
    periodStart: `${month}-01`,
    periodEndExclusive: `${addMonths(month, 1)}-01`,
    appliedFilters: {
      performedByMemberId: null,
      assetOwnerType: 'ALL',
      assetOwnerMemberId: null,
      categoryId: null,
    },
    totals: { incomeWon: 210_000, expenseWon: 0, netWon: 210_000 },
    categoryBreakdown,
    yearlyTrend: Array.from({ length: 12 }, (_, index) => ({
      month: `${month.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`,
      incomeWon: index + 1 === Number(month.slice(5)) ? 210_000 : 0,
      expenseWon: 0,
      netWon: index + 1 === Number(month.slice(5)) ? 210_000 : 0,
    })),
  }

  await page.route(/\/api\/statistics\/monthly\?/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(monthlyStatistics),
  }))
  await page.evaluate(() => localStorage.setItem('dondok-theme', 'light'))
  await page.goto(`/statistics?month=${month}&direction=income`)

  const chart = page.getByRole('img', { name: '수입 분류 비중 원형 차트' })
  const slices = chart.locator('[data-category-donut-slice]')
  const markers = page.getByRole('list', { name: '수입 분류 비중' }).locator('[data-category-tone]')
  const expectedTokens = Array.from({ length: 6 }, (_, index) => `var(--chart-${index + 1})`)
  await expect(slices).toHaveCount(6)
  await expect(markers).toHaveCount(6)
  expect(await slices.evaluateAll((elements) => elements.map((element) => element.getAttribute('stroke')))).toEqual(expectedTokens)
  expect(await markers.evaluateAll((elements) => elements.map((element) => element.getAttribute('style')))).toEqual(
    expectedTokens.map((token) => `background-color: ${token};`),
  )

  const lightColors = await resolvedCategoryColors(slices)
  const lightDirectionColors = await page.evaluate(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const resolve = (token: string) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('stroke', `var(${token})`)
      svg.append(circle)
      const color = getComputedStyle(circle).stroke
      circle.remove()
      return color
    }
    document.body.append(svg)
    const colors = [resolve('--income'), resolve('--expense')]
    svg.remove()
    return colors
  })
  expect(new Set(lightColors).size, '밝은 테마의 원형 차트 조각 색은 서로 구별되어야 합니다').toBe(6)
  expect(lightColors.every((color) => !lightDirectionColors.includes(color)), '분류색은 수입·지출 의미색과 분리되어야 합니다').toBe(true)

  await page.getByRole('button', { name: '밝은 테마 사용 중. 어두운 테마로 변경' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const darkColors = await resolvedCategoryColors(slices)
  expect(new Set(darkColors).size, '어두운 테마의 원형 차트 조각 색은 서로 구별되어야 합니다').toBe(6)
  expect(darkColors).not.toEqual(lightColors)
})

async function createSharedStatisticsFixture(page: Page, request: APIRequestContext): Promise<StatisticsSeed> {
  const ownerName = `통계 작성자 ${test.info().workerIndex}`
  const otherMemberName = `통계 구성원 ${test.info().workerIndex}`
  const owner = await registerAndLogin(page, request, ownerName)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const invitationCode = await issueInvitation(page)

  await page.getByRole('button', { name: '로그아웃' }).click()
  await registerAndLogin(page, request, otherMemberName)
  await redeemInvitation(page, invitationCode)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await login(page, owner)

  const seeded = await seedStatisticsLedger(page)
  return { ownerLoginId: owner.loginId, otherMemberName, ...seeded }
}

async function issueInvitation(page: Page) {
  return page.evaluate(async () => {
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const mutateJson = async <T,>(path: string, csrf: { headerName: string; token: string }): Promise<T> => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
      })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    return mutateJson<{ code: string }>('/api/ledger-books/current/invitations', csrf)
      .then((invitation) => invitation.code)
  })
}

async function redeemInvitation(page: Page, code: string) {
  await page.evaluate(async (invitationCode) => {
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const response = await fetch('/api/ledger-invitations/redemptions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
      body: JSON.stringify({ code: invitationCode }),
    })
    if (!response.ok) throw new Error(`/api/ledger-invitations/redemptions returned ${response.status}`)
  }, code)
}

async function login(page: Page, account: { loginId: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('아이디').fill(account.loginId)
  await page.getByLabel('비밀번호').fill(account.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
}

async function seedStatisticsLedger(page: Page): Promise<Omit<StatisticsSeed, 'ownerLoginId' | 'otherMemberName'>> {
  const currentMonth = monthInSeoul()
  const previousMonth = addMonths(currentMonth, -1)
  const dates = {
    incomeOwner: `${currentMonth}-02`,
    expenseOwner: `${currentMonth}-03`,
    expenseOther: `${currentMonth}-04`,
    expenseJoint: `${currentMonth}-05`,
    transportJoint: `${currentMonth}-06`,
    incomeJoint: `${currentMonth}-07`,
    currentCardPurchase: `${currentMonth}-08`,
    transfer: `${currentMonth}-09`,
    refund: `${currentMonth}-10`,
    previousCardPurchase: `${previousMonth}-05`,
  }

  return page.evaluate(async ({ currentMonth, previousMonth, dates }) => {
    type Member = { memberId: string; currentUser: boolean; displayName: string }
    type Asset = { assetId: string; assetTypeId: string; systemCode: string; name: string }
    type AssetType = { assetTypeId: string; systemCode: string }
    type Category = { categoryId: string; kind: 'INCOME' | 'EXPENSE'; systemCode: string | null; name: string }
    type Transaction = { transactionId: string; version: number }
    type Statement = { statementId: string; remainingAmountWon: number; version: number }
    type StatementPage = { items: Statement[] }
    type Preview = { previewToken: string; statementVersion: number; amountWon: number }

    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const current = await requiredJson<{ ledger: { members: Member[] } }>('/api/ledger-books/current')
    const assets = await requiredJson<Asset[]>('/api/assets')
    const assetTypes = await requiredJson<AssetType[]>('/api/asset-types')
    const incomes = await requiredJson<Category[]>('/api/categories?kind=INCOME')
    const expenses = await requiredJson<Category[]>('/api/categories?kind=EXPENSE')
    const owner = current.ledger.members.find((member) => member.currentUser)
    const other = current.ledger.members.find((member) => !member.currentUser)
    if (!owner || !other) throw new Error('statistics seed requires two ledger members')
    const account = assets.find((asset) => asset.systemCode === 'BANK')
    const card = assets.find((asset) => asset.systemCode === 'CREDIT_CARD')
    const bankType = assetTypes.find((assetType) => assetType.systemCode === 'BANK')
    const incomeOther = incomes.find((category) => category.systemCode === 'OTHER')
    const food = expenses.find((category) => category.systemCode === 'FOOD')
    const transport = expenses.find((category) => category.systemCode === 'TRANSPORT')
    if (!account || !card || !bankType || !incomeOther || !food || !transport) {
      throw new Error('statistics seed defaults were not found')
    }
    const requestIds: string[] = []
    const includedTransactionIds: string[] = []
    const excludedTransactionIds: string[] = []

    const mutate = async <T,>(path: string, body: unknown, idempotent = false): Promise<T> => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          [csrf.headerName]: csrf.token,
          ...(idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`)
      const requestId = response.headers.get('X-Request-Id')
      if (requestId) requestIds.push(requestId)
      return response.json() as Promise<T>
    }
    const createTransaction = async (body: Record<string, unknown>, included: boolean) => {
      const transaction = await mutate<Transaction>('/api/transactions', body, true)
      ;(included ? includedTransactionIds : excludedTransactionIds).push(transaction.transactionId)
      return transaction
    }

    const jointAsset = await mutate<Asset>('/api/assets', {
      assetTypeId: bankType.assetTypeId,
      ownershipScope: 'JOINT',
      ownerMemberId: null,
      name: '공동 통계 계좌',
      openedOn: `${currentMonth}-01`,
      memo: null,
      openingBalanceWon: 777_777,
      cardSettings: null,
      debitCardSettings: null,
      savingsSettings: null,
    }, true)

    await createTransaction({ type: 'INCOME', occurredOn: dates.incomeOwner, amountWon: 500_000, categoryId: incomeOther.categoryId, assetId: account.assetId, performedByMemberId: owner.memberId, description: '통계 수입 A' }, true)
    await createTransaction({ type: 'INCOME', occurredOn: dates.incomeJoint, amountWon: 100_000, categoryId: incomeOther.categoryId, assetId: jointAsset.assetId, performedByMemberId: other.memberId, description: '통계 수입 B 공동' }, true)
    await createTransaction({ type: 'EXPENSE', occurredOn: dates.expenseOwner, amountWon: 10_000, categoryId: food.categoryId, assetId: account.assetId, performedByMemberId: owner.memberId, description: '통계 지출 A 식비' }, true)
    await createTransaction({ type: 'EXPENSE', occurredOn: dates.expenseOther, amountWon: 20_000, categoryId: food.categoryId, assetId: account.assetId, performedByMemberId: other.memberId, description: '통계 지출 B 개인 식비' }, true)
    await createTransaction({ type: 'EXPENSE', occurredOn: dates.expenseJoint, amountWon: 30_000, categoryId: food.categoryId, assetId: jointAsset.assetId, performedByMemberId: other.memberId, description: '통계 지출 B 공동 식비' }, true)
    await createTransaction({ type: 'EXPENSE', occurredOn: dates.transportJoint, amountWon: 40_000, categoryId: transport.categoryId, assetId: jointAsset.assetId, performedByMemberId: other.memberId, description: '통계 지출 B 공동 교통' }, true)
    const currentCardPurchase = await createTransaction({ type: 'EXPENSE', occurredOn: dates.currentCardPurchase, amountWon: 120_000, categoryId: food.categoryId, assetId: card.assetId, performedByMemberId: other.memberId, description: '통계 포함 카드 구매', installmentCount: 1 }, true)
    const previousCardPurchase = await createTransaction({ type: 'EXPENSE', occurredOn: dates.previousCardPurchase, amountWon: 400_000, categoryId: food.categoryId, assetId: card.assetId, performedByMemberId: other.memberId, description: '지난달 카드 구매', installmentCount: 1 }, true)
    await createTransaction({ type: 'TRANSFER', occurredOn: dates.transfer, amountWon: 50_000, sourceAssetId: account.assetId, destinationAssetId: jointAsset.assetId, performedByMemberId: other.memberId, description: '통계 제외 일반 이체' }, false)

    const refundInput = { refundedOn: dates.refund, amountWon: 400_000, expectedVersion: previousCardPurchase.version, description: '이번달 실제 환불' }
    const refundPreview = await mutate<{ previewToken: string }>(`/api/transactions/${previousCardPurchase.transactionId}/card-purchase-refunds/preview`, refundInput)
    const refund = await mutate<{ refundTransaction: Transaction }>(`/api/transactions/${previousCardPurchase.transactionId}/card-purchase-refunds`, { ...refundInput, previewToken: refundPreview.previewToken }, true)
    includedTransactionIds.push(refund.refundTransaction.transactionId)

    const statementPage = await requiredJson<StatementPage>(`/api/assets/${card.assetId}/card-statements?includePaid=false&limit=20`)
    const statement = statementPage.items.find((candidate) => candidate.remainingAmountWon === 120_000)
    if (!statement) throw new Error('current card statement for statistics seed was not found')
    const preview = await mutate<Preview>(`/api/card-statements/${statement.statementId}/prepayments/preview`, { amountWon: 30_000, expectedVersion: statement.version })
    const payment = await mutate<{ settlementTransaction: Transaction }>(`/api/card-statements/${statement.statementId}/prepayments`, { amountWon: 30_000, expectedVersion: preview.statementVersion, previewToken: preview.previewToken }, true)
    excludedTransactionIds.push(payment.settlementTransaction.transactionId)

    const statisticsResponse = await fetch(`/api/statistics/monthly?month=${encodeURIComponent(currentMonth)}`, { credentials: 'include' })
    if (!statisticsResponse.ok) throw new Error(`initial statistics returned ${statisticsResponse.status}`)
    const requestId = statisticsResponse.headers.get('X-Request-Id')
    if (requestId) requestIds.push(requestId)
    const initialStatistics = await statisticsResponse.json() as MonthlyStatistics

    return {
      ownerMemberId: owner.memberId,
      otherMemberId: other.memberId,
      jointAssetId: jointAsset.assetId,
      cardAssetId: card.assetId,
      foodCategoryId: food.categoryId,
      currentMonth,
      previousMonth,
      includedTransactionIds,
      excludedTransactionIds,
      requestIds,
      initialStatistics,
    }
  }, { currentMonth, previousMonth, dates })
}

async function expectStatisticsSummary(page: Page, expected: { income: string; expense: string; net: string }) {
  const summary = page.getByLabel('월간 수입 지출 순액 요약')
  await expectSummaryValue(summary, '수입', expected.income)
  await expectSummaryValue(summary, '지출', expected.expense)
  await expectSummaryValue(summary, '순액', expected.net)
}

async function expectSummaryValue(summary: Locator, label: string, value: string) {
  const item = summary.getByText(label, { exact: true }).locator('..')
  await expect(item.getByText(value, { exact: true })).toBeVisible()
}

async function expectCategoryAmount(list: Locator, category: string, amount: string) {
  const row = list.getByRole('listitem').filter({ hasText: category })
  await expect(row.getByText(category, { exact: true })).toBeVisible()
  await expect(row.getByText(amount, { exact: true })).toBeVisible()
}

async function expectLabeledValue(scope: Locator, label: string, value: string) {
  const item = scope.getByText(label, { exact: true }).locator('..')
  await expect(item.getByText(value, { exact: true })).toBeVisible()
}

async function expectFilterContract(dialog: Locator) {
  for (const name of ['구성원', '자산 소유자', '분류']) {
    const group = dialog.getByRole('group', { name })
    await expect(group).toBeVisible()
    const allRadio = group.getByRole('radio', { name: '전체', exact: true })
    await expect(allRadio).toBeVisible()
    await expectTouchTarget(allRadio.locator('..'), `${name} 전체 radio`)
  }
  await expectTouchTarget(dialog.getByRole('button', { name: '필터 적용' }), '필터 적용')
  await expectTouchTarget(dialog.getByRole('button', { name: '필터 초기화' }), '필터 초기화')
  await expectTouchTarget(dialog.getByRole('button', { name: '통계 필터 닫기' }), '통계 필터 닫기')
}

async function expectFilterDraftAcrossRotation(page: Page, controls: { memberRadio: Locator; jointRadio: Locator; foodRadio: Locator }) {
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(controls.memberRadio, `${viewport.label} 구성원 draft`).toBeChecked()
    await expect(controls.jointRadio, `${viewport.label} 자산 소유자 draft`).toBeChecked()
    await expect(controls.foodRadio, `${viewport.label} 분류 draft`).toBeChecked()
    await expect(controls.foodRadio, `${viewport.label} focus`).toBeFocused()
    expect(await hasPageOverflow(page), `${viewport.label} filter dialog page overflow`).toBe(false)
  }
}

async function expectResponsiveStatisticsState(page: Page, focused: Locator, month: string) {
  await focused.focus()
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(month)
    await expect.poll(() => new URL(page.url()).searchParams.get('direction')).toBe('income')
    await expect(focused, `${viewport.label} 분류 방향 focus`).toBeFocused()
    await expect(focused, `${viewport.label} 분류 방향`).toHaveAttribute('aria-pressed', 'true')
    await expectTouchTarget(focused, `${viewport.label} 분류 방향`)
    await expectStatisticsSummary(page, { income: '+600,000원', expense: '+180,000원', net: '+780,000원' })
    await expect(page.getByRole('img', { name: '수입 분류 비중 원형 차트' }), `${viewport.label} 원형 차트`).toBeVisible()
    const yearlyChart = page.getByRole('img', { name: `${month.slice(0, 4)}년 월별 수입 지출 막대그래프` })
    await expect(yearlyChart, `${viewport.label} 연간 막대그래프`).toBeVisible()
    await expect(yearlyChart.locator('[data-month-bar-group]'), `${viewport.label} 열두 달 막대`).toHaveCount(12)
    await expectTouchTarget(page.getByRole('button', { name: '이전 달' }), `${viewport.label} 이전 달`)
    await expectTouchTarget(page.getByRole('button', { name: '다음 달' }), `${viewport.label} 다음 달`)
    expect(await hasPageOverflow(page), `${viewport.label} statistics page overflow`).toBe(false)
  }
}

async function expectCoreNavigation(page: Page) {
  const navigation = primaryNavigation(page)
  for (const name of ['홈', '기록', '자산', '통계']) {
    await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible()
  }
  await expect(navigation.getByRole('link', { name: '설정', exact: true })).toHaveCount(0)
}

function primaryNavigation(page: Page) {
  return page.getByRole('navigation', { name: '주요 메뉴' })
    .or(page.getByRole('complementary', { name: '주요 메뉴' }).getByRole('navigation'))
}

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} 조작 영역이 보여야 합니다`).not.toBeNull()
  expect(box!.width, `${label} 조작 영역 너비`).toBeGreaterThanOrEqual(44)
  expect(box!.height, `${label} 조작 영역 높이`).toBeGreaterThanOrEqual(44)
}

async function attachSeedManifest(testInfo: TestInfo, page: Page, seed: StatisticsSeed) {
  const evidence = evidenceByPage.get(page)
  await testInfo.attach('statistics-seed-manifest', {
    body: Buffer.from(JSON.stringify({
      runId: evidence?.runId,
      seedVersion: 'statistics-ui-v1',
      migrationVersion: 'V14',
      timezone: 'Asia/Seoul',
      ownerLoginId: seed.ownerLoginId,
      ownerMemberId: seed.ownerMemberId,
      otherMemberId: seed.otherMemberId,
      jointAssetId: seed.jointAssetId,
      cardAssetId: seed.cardAssetId,
      foodCategoryId: seed.foodCategoryId,
      currentMonth: seed.currentMonth,
      previousMonth: seed.previousMonth,
      includedTransactionIds: seed.includedTransactionIds,
      excludedTransactionIds: seed.excludedTransactionIds,
      requestIds: seed.requestIds,
    }, null, 2)),
    contentType: 'application/json',
  })
}

function monthInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
}

function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

async function resolvedCategoryColors(slices: Locator) {
  return slices.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke))
}
