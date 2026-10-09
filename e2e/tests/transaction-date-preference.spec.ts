import { expect, test, type Page } from '@playwright/test'
import { registerAndLogin } from './support/auth'
import { selectDate } from './support/date-picker'

test.use({ serviceWorkers: 'block' })

test('마지막 신규 저장 날짜를 복원하고 선택 날짜·편집·초안을 우선한다', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  const evidence: unknown[] = []
  page.on('console', (message) => { if (message.type() === 'error') evidence.push({ console: message.text() }) })
  page.on('pageerror', (error) => evidence.push({ error: error.message }))
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) evidence.push({ path, status: response.status(), requestId: response.headers()['x-request-id'] })
  })
  try {
    const account = await registerAndLogin(page, request, `날짜 기억 ${testInfo.workerIndex}`)
    await page.getByRole('button', { name: '가계부 시작하기' }).click()
    await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()
    await testInfo.attach('seed-manifest', { body: JSON.stringify({ scenario: 'last-transaction-date-v1', loginId: account.loginId }), contentType: 'application/json' })

    const firstDate = daysAgo(3)
    const lastDate = daysAgo(6)
    const explicitDate = daysAgo(1)
    await page.goto('/transactions/new')
    const date = page.getByLabel('날짜', { exact: true })
    await expect(date).toHaveAttribute('data-value', daysAgo(0))
    const first = await saveTransaction(page, firstDate)

    // 전체 재진입으로 TanStack Query 메모리가 없어져도 선호값은 유지된다.
    // 저장 후 홈에서 시작한 조회는 재진입 폼의 조회로 세지 않는다.
    await page.goto('about:blank')
    const transactionReads: string[] = []
    const trackReads = (request: import('@playwright/test').Request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/api/transactions')) transactionReads.push(request.url())
    }
    page.on('request', trackReads)
    await page.goto('/transactions/new')
    await expect(date).toHaveAttribute('data-value', firstDate)
    expect(transactionReads).toEqual([])
    page.off('request', trackReads)
    await page.getByRole('button', { name: '수입', exact: true }).click()
    await saveTransaction(page, lastDate)
    await page.goto('/transactions/new')
    await expect(date).toHaveAttribute('data-value', lastDate)

    // 취소와 서버 저장 실패는 기억한 날짜를 변경하지 않는다.
    await selectDate(page, '날짜', explicitDate)
    await page.getByLabel('금액', { exact: true }).fill('1000')
    await page.route('**/api/transactions', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', json: { title: 'QC 저장 실패', status: 503, detail: 'QC 저장 실패' } })
      : route.continue())
    await page.getByRole('button', { name: '기록 저장' }).click()
    await expect(page.getByRole('alert')).toContainText('QC 저장 실패')
    await expect(date).toHaveAttribute('data-value', explicitDate)
    await page.getByRole('link', { name: '홈', exact: true }).click()
    await page.getByRole('button', { name: '나가기', exact: true }).click()
    await page.unroute('**/api/transactions')
    await page.goto('/transactions/new')
    await expect(date).toHaveAttribute('data-value', lastDate)

    await page.goto(`/transactions/${first.transactionId}/edit`)
    await expect(date).toHaveAttribute('data-value', firstDate)
    await selectDate(page, '날짜', explicitDate)
    await page.getByRole('button', { name: '변경 저장', exact: true }).click()
    await expect(page).not.toHaveURL(/\/edit$/)
    await page.goto('/transactions/new')
    await expect(date).toHaveAttribute('data-value', lastDate)

    await page.goto(`/?month=${explicitDate.slice(0, 7)}&date=${explicitDate}&detail=day`)
    await page.getByRole('link', { name: /에 거래 기록$/ }).click()
    await expect(date).toHaveAttribute('data-value', explicitDate)

    // 다른 탭의 저장과 화면 회전은 열린 폼의 날짜·입력을 덮지 않는다.
    await page.getByLabel('내용 (선택)').fill('작성 중 유지')
    const otherTab = await page.context().newPage()
    await otherTab.goto('/transactions/new')
    await expect(otherTab.getByLabel('날짜', { exact: true })).toHaveAttribute('data-value', lastDate)
    await saveTransaction(otherTab, firstDate)
    await otherTab.close()
    await page.bringToFront()
    for (const width of [320, 767, 768, 834, 1194, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(date).toHaveAttribute('data-value', explicitDate)
      await expect(page.getByLabel('내용 (선택)')).toHaveValue('작성 중 유지')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.getByRole('link', { name: '홈', exact: true }).click()
    await page.getByRole('button', { name: '나가기', exact: true }).click()

    await page.goto(`/assets/${first.asset.assetId}`)
    await page.getByRole('button', { name: '기록 추가', exact: true }).click()
    await expect(date).toHaveAttribute('data-value', firstDate)
    await saveTransaction(page, lastDate, true)
    await page.getByRole('button', { name: '기록 추가', exact: true }).click()
    await expect(date).toHaveAttribute('data-value', lastDate)
  } finally {
    await testInfo.attach('console-network-request-ids', { body: JSON.stringify(evidence), contentType: 'application/json' })
  }
})

async function saveTransaction(page: Page, occurredOn: string, embedded = false) {
  await selectDate(page, '날짜', occurredOn)
  await page.getByLabel('금액', { exact: true }).fill('1000')
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/transactions'
    && response.request().method() === 'POST' && response.status() === 201)
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  const transaction = await (await response).json() as { transactionId: string; asset: { assetId: string } }
  if (embedded) await expect(page.getByRole('dialog', { name: '거래 기록', exact: true })).toHaveCount(0)
  else await expect(page).not.toHaveURL(/\/transactions\/new$/)
  return transaction
}

function daysAgo(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - days * 86_400_000))
}
