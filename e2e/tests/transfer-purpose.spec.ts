import { expect, test } from '@playwright/test'
import { registerAndLogin } from './support/auth'
import { selectAsset } from './support/asset-picker'

test.use({ serviceWorkers: 'block' })

test('이체 목적은 저장·수정·회전 뒤에도 유지되고 납입과 회수를 월별로 집계한다 @pr', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  const consoleMessages: string[] = []
  const network: Array<{ path: string; status: number; requestId: string | null }> = []
  page.on('pageerror', (error) => consoleMessages.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') consoleMessages.push(message.text().replace(/token=[^\s&]+/g, 'token=[redacted]')) })
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) network.push({ path, status: response.status(), requestId: response.headers()['x-request-id'] ?? null })
  })
  try {
    await registerAndLogin(page, request, '이체 목적 검증')
    await page.getByRole('button', { name: '가계부 시작하기' }).click()
    await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()
    await page.goto('/statistics')
    await expect(page.getByText('이번 달 수입·소비·적금·투자 기록이 없습니다', { exact: true })).toBeVisible()
    const seed = await page.evaluate(async () => {
      const get = async (path: string) => {
        const response = await fetch(path)
        if (!response.ok) throw new Error(`seed GET ${path}: ${response.status}`)
        return response.json()
      }
      const csrf = await get('/api/auth/csrf')
      const current = await get('/api/ledger-books/current')
      const memberId = current.ledger.members.find((member: { currentUser: boolean }) => member.currentUser).memberId
      const types = await get('/api/asset-types')
      const assets = await get('/api/assets')
      const bank = assets.find((asset: { systemCode: string }) => asset.systemCode === 'BANK')
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
      const post = async (path: string, body: unknown) => {
        const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) })
        if (!response.ok) throw new Error(`seed POST ${path}: ${response.status}`)
        return response.json()
      }
      const savings = await post('/api/assets', { assetTypeId: types.find((type: { systemCode: string }) => type.systemCode === 'SAVINGS').assetTypeId, name: '검증 적금', ownershipScope: 'PERSONAL', ownerMemberId: memberId, openingBalanceWon: 0, openedOn: `${date.slice(0, 7)}-01` })
      const investment = await post('/api/assets', { assetTypeId: types.find((type: { systemCode: string }) => type.systemCode === 'INVESTMENT').assetTypeId, name: '검증 투자', ownershipScope: 'PERSONAL', ownerMemberId: memberId, openingBalanceWon: 0, openedOn: `${date.slice(0, 7)}-01` })
      const income = (await get('/api/categories?kind=INCOME'))[0]
      const expense = (await get('/api/categories?kind=EXPENSE'))[0]
      await post('/api/transactions', { type: 'INCOME', occurredOn: date, amountWon: 3_000_000, assetId: bank.assetId, categoryId: income.categoryId, performedByMemberId: memberId })
      await post('/api/transactions', { type: 'EXPENSE', occurredOn: date, amountWon: 1_200_000, assetId: bank.assetId, categoryId: expense.categoryId, performedByMemberId: memberId })
      await post('/api/transactions', { type: 'TRANSFER', occurredOn: date, amountWon: 300_000, sourceAssetId: bank.assetId, destinationAssetId: investment.assetId, performedByMemberId: memberId, transferPurpose: 'INVESTMENT_DEPOSIT' })
      await post('/api/transactions', { type: 'TRANSFER', occurredOn: date, amountWon: 200_000, sourceAssetId: savings.assetId, destinationAssetId: bank.assetId, performedByMemberId: memberId, transferPurpose: 'SAVINGS_WITHDRAWAL' })
      return { memberId, bankId: bank.assetId, savingsId: savings.assetId, investmentId: investment.assetId, date }
    })
    await testInfo.attach('seed-manifest', { body: JSON.stringify({ ...seed, version: 'transfer-purpose-v1' }), contentType: 'application/json' })
    await page.goto('/transactions/new')
    await page.getByLabel('금액', { exact: true }).fill('500000')
    const calculator = page.getByRole('dialog', { name: '금액 계산기' })
    if (await calculator.isVisible()) await calculator.getByRole('button', { name: '완료', exact: true }).click()
    await page.getByRole('button', { name: '이체', exact: true }).click()
    await selectAsset(page, '보내는 자산', '계좌')
    await selectAsset(page, '받는 자산', '검증 적금')
    const purpose = page.getByRole('button', { name: '적금 납입', exact: true })
    await expect(purpose).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '일반 이체', exact: true }).click()
    await selectAsset(page, '받는 자산', '검증 투자')
    await expect(page.getByRole('button', { name: '일반 이체', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await selectAsset(page, '받는 자산', '검증 적금')
    await purpose.click()
    for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1180, height: 820 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport)
      await expect(purpose).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByLabel('금액', { exact: true })).toHaveValue('500,000')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
    const createdResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/transactions' && response.request().method() === 'POST')
    await page.getByRole('button', { name: '기록 저장', exact: true }).click()
    const response = await createdResponse
    expect(response.status()).toBe(201)
    const transaction = await response.json()
    expect(transaction.transferPurpose).toBe('SAVINGS_DEPOSIT')
    expect(transaction.postings.map((posting: { deltaWon: number }) => posting.deltaWon)).toEqual([-500000, 500000])
    await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '통계', exact: true }).click()
    const summary = page.getByLabel('월간 자금 사용 요약')
    await expect(summary.getByText('-2,000,000원', { exact: true })).toBeVisible()
    await expect(summary.getByText('+1,000,000원', { exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '통계 보기' })).toHaveCount(0)
    await expect(page.getByRole('list', { name: '사용처 순위' }).getByRole('listitem')).toHaveCount(3)
    const ranking = page.getByRole('list', { name: '사용처 순위' })
    expect(await ranking.getByRole('listitem').allTextContents()).toEqual([
      expect.stringMatching(/1.*1,200,000원.*60%/),
      expect.stringMatching(/2.*적금.*500,000원.*25%/),
      expect.stringMatching(/3.*투자.*300,000원.*15%/),
    ])
    await expect(page.getByRole('region', { name: '적금 납입과 회수' })).toBeHidden()
    await page.getByText('적금·투자 납입과 회수 자세히 보기', { exact: true }).click()
    await expect(page.getByRole('region', { name: '적금 납입과 회수' }).getByText(/순납입.*\+300,000원/)).toBeVisible()
    await expect(page.getByRole('region', { name: '투자 납입과 회수' }).getByText('+300,000원', { exact: true }).first()).toBeVisible()
    for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1180, height: 820 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await expect(page.getByRole('list', { name: '사용처 순위' })).toBeVisible()
    }
    await page.getByText('월별 금액 목록', { exact: true }).click()
    await expect(page.getByLabel(`${seed.date.slice(0, 4)}년 월별 금액 목록`).getByRole('listitem')).toHaveCount(12)
    await page.goto(`/statistics?month=${seed.date.slice(0, 7)}&view=formation`)
    await expect(page).not.toHaveURL(/view=/)
    await page.screenshot({ path: testInfo.outputPath('statistics-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('statistics-mobile.png'), fullPage: true })
    await page.goto(`/transactions/${transaction.transactionId}/edit`)
    await expect(page.getByRole('button', { name: '적금 납입', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '일반 이체', exact: true }).click()
    const updateResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes(transaction.transactionId))
    await page.getByRole('button', { name: '변경 저장', exact: true }).click()
    expect((await updateResponse).status()).toBe(200)
    // Follow the completed save through the app instead of unloading its in-flight home requests.
    await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '통계', exact: true }).click()
    await page.getByText('적금·투자 납입과 회수 자세히 보기', { exact: true }).click()
    await expect(page.getByRole('region', { name: '적금 납입과 회수' }).getByText(/순납입.*-200,000원/)).toBeVisible()
    expect(consoleMessages).toEqual([])
  } finally {
    await testInfo.attach('console', { body: JSON.stringify(consoleMessages), contentType: 'application/json' })
    await testInfo.attach('network-request-ids', { body: JSON.stringify(network), contentType: 'application/json' })
  }
})
