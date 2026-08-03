import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { cardAssetRow, expectCardPaymentAmounts } from './support/assets'
import { registerAndLogin } from './support/auth'
import { selectTransactionCategory, transactionCategoryTrigger } from './support/transactions'

type Evidence = {
  runId: string
  console: Array<{ type: string; text: string }>
  pageErrors: string[]
  network: Array<{ method: string; path: string; status: number; requestId: string | null }>
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
  const runId = `card-purchase-${Date.now()}-${testInfo.workerIndex}-${Math.floor(Math.random() * 10_000)}`
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
  await testInfo.attach('card-purchase-console', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, messages: evidence.console, pageErrors: evidence.pageErrors }, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach('card-purchase-network', {
    body: Buffer.from(JSON.stringify({ runId: evidence.runId, requests: evidence.network }, null, 2)),
    contentType: 'application/json',
  })
})

test('미결제 카드 구매 환불은 원 구매를 남기고 환불일·달력·카드 결제 예정액을 함께 맞춘다', async ({ page, request }, testInfo) => {
  const month = currentMonthInSeoul()
  const purchaseDate = `${month}-05`
  const refundDate = `${month}-06`
  const purchaseDescription = `QC 원 구매 ${Date.now().toString().slice(-6)}`
  const refundDescription = `QC 미결제 환불 ${Date.now().toString().slice(-6)}`
  const account = await registerAndLogin(page, request, `카드 환불 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'unpaid-refund', purchaseDate, refundDate, purchaseDescription, refundDescription,
  })

  await createCardPurchase(page, {
    amount: '80000',
    occurredOn: purchaseDate,
    description: purchaseDescription,
  })
  const originalRow = transactionRow(page, purchaseDescription)
  await expect(originalRow.getByText('-80,000원', { exact: true })).toBeVisible()
  await originalRow.getByRole('link', { name: new RegExp(`${purchaseDescription}.*지출.*원 카드 구매 상세`) }).click()

  await expect(page.getByRole('heading', { name: '카드 구매 상세' })).toBeVisible()
  await expect(page.getByText('구매 금액', { exact: true }).locator('..')).toContainText('80,000원')
  await expect(page.getByRole('link', { name: '기록 정정', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '환불 처리', exact: true })).toBeVisible()
  const detailUrl = page.url()

  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expectCardPaymentAmounts(cardAssetRow(page, '신용카드'), { currentMonth: '0원', nextMonth: '80,000원' })
  await page.goto(detailUrl)
  await page.getByRole('link', { name: '환불 처리', exact: true }).click()

  await expect(page.getByRole('heading', { name: '카드 구매 환불' })).toBeVisible()
  const amount = page.getByLabel('환불 금액')
  const date = page.getByLabel('환불일')
  const description = page.getByLabel('내용 (선택)')
  await amount.fill('30,000')
  await date.fill(refundDate)
  await description.fill(refundDescription)
  await expectDraftAndFocusAcrossViewports(page, description, refundDescription, '환불 내용 확인')

  const releaseRefundPreview = await delayNextRequest(page, '**/card-purchase-refunds/preview')
  await page.getByRole('button', { name: '환불 내용 확인' }).click()
  await expect(amount).toBeDisabled()
  await expect(date).toBeDisabled()
  await expect(description).toBeDisabled()
  releaseRefundPreview()
  const refundPreview = page.getByRole('region', { name: '환불 반영 내용' })
  await expect(refundPreview).toBeVisible()
  await expect(refundPreview.getByRole('heading', { name: '환불 반영 내용' })).toBeFocused()
  await expect(refundPreview.getByText('미결제 카드 금액 감소').locator('..')).toContainText('30,000원')
  await expect(refundPreview).toContainText('원 결제 계좌에 반환 기록할 금액이 없어요.')
  await expectTouchTarget(refundPreview.getByRole('button', { name: '환불 기록' }), '환불 기록')
  await refundPreview.getByRole('button', { name: '환불 기록' }).click()

  await expect(page.getByRole('heading', { name: '카드 구매 상세' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('환불을 기록했어요.')
  await expect(page.getByText('구매 금액', { exact: true }).locator('..')).toContainText('80,000원')
  await expect(page.getByText('내용', { exact: true }).locator('..')).toContainText(purchaseDescription)
  await expect(page.getByText('환불 가능 50,000원', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '환불 처리 내역' }).locator('..')).toContainText('+30,000원')

  await page.getByRole('link', { name: '가계부로 돌아가기' }).click()
  await expect(page.getByRole('button', { name: '일별 보기' })).toHaveAttribute('aria-pressed', 'true')
  await expect(transactionRow(page, purchaseDescription).getByText('-80,000원', { exact: true })).toBeVisible()
  const refundRow = transactionRow(page, refundDescription)
  await expect(refundRow.getByText('+30,000원', { exact: true })).toBeVisible()
  await expect(refundRow.getByText('환불', { exact: true })).toBeVisible()
  await refundRow.getByRole('link', { name: `${refundDescription}, 환불 +30,000원, 원 카드 구매 상세` }).click()
  await expect(page.getByRole('heading', { name: '카드 구매 상세' })).toBeVisible()

  await page.getByRole('link', { name: '가계부로 돌아가기' }).click()
  await page.getByRole('button', { name: '월간 달력' }).click()
  await expect(page.getByTitle('-50,000원', { exact: true }).first()).toBeVisible()
  await expect(page.getByTitle('지출 -80,000원', { exact: true })).toBeVisible()
  await expect(page.getByTitle('환불 +30,000원', { exact: true })).toBeVisible()
  expect(await hasPageOverflow(page)).toBe(false)

  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expectCardPaymentAmounts(cardAssetRow(page, '신용카드'), { currentMonth: '0원', nextMonth: '50,000원' })
})

test('카드 구매 기록 정정은 preview 뒤 변경된 구매와 명세를 원 구매 대신 반영한다', async ({ page, request }, testInfo) => {
  const month = currentMonthInSeoul()
  const purchaseDate = `${month}-08`
  const correctedDate = `${month}-09`
  const originalDescription = `QC 정정 전 ${Date.now().toString().slice(-6)}`
  const correctedDescription = `QC 정정 후 ${Date.now().toString().slice(-6)}`
  const account = await registerAndLogin(page, request, `카드 정정 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await attachSeedManifest(testInfo, page, account.loginId, {
    flow: 'purchase-correction', purchaseDate, correctedDate, originalDescription, correctedDescription,
  })

  await createCardPurchase(page, {
    amount: '90000',
    occurredOn: purchaseDate,
    description: originalDescription,
  })
  await transactionRow(page, originalDescription)
    .getByRole('link', { name: new RegExp(`${originalDescription}.*지출.*원 카드 구매 상세`) })
    .click()
  await page.getByRole('link', { name: '기록 정정', exact: true }).click()

  await expect(page.getByRole('heading', { name: '카드 구매 기록 정정' })).toBeVisible()
  const amount = page.getByLabel('금액')
  const date = page.getByLabel('구매 날짜')
  const description = page.getByLabel('내용 (선택)')
  await amount.fill('60,000')
  await date.fill(correctedDate)
  await description.fill(correctedDescription)
  await expectDraftAndFocusAcrossViewports(page, description, correctedDescription, '변경 내용 확인')

  await page.getByRole('button', { name: '변경 내용 확인' }).click()
  let preview = page.getByRole('region', { name: '변경 영향' })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('heading', { name: '변경 영향' })).toBeFocused()
  await expect(preview).toContainText('90,000원')
  await expect(preview).toContainText('→ 60,000원')
  await expect(preview.getByText('미결제 카드 금액 감소').locator('..')).toContainText('30,000원')

  await amount.fill('65,000')
  await expect(preview).toHaveCount(0)
  await expect(description).toHaveValue(correctedDescription)
  await page.getByRole('button', { name: '변경 내용 확인' }).click()
  preview = page.getByRole('region', { name: '변경 영향' })
  await expect(preview.getByText('미결제 카드 금액 감소').locator('..')).toContainText('25,000원')
  await expectTouchTarget(preview.getByRole('button', { name: '정정 적용' }), '정정 적용')
  await preview.getByRole('button', { name: '정정 적용' }).click()

  await expect(page.getByRole('heading', { name: '카드 구매 상세' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('카드 구매 기록을 정정했어요.')
  await expect(page.getByText('구매 날짜', { exact: true }).locator('..')).toContainText(correctedDate)
  await expect(page.getByText('구매 금액', { exact: true }).locator('..')).toContainText('65,000원')
  await expect(page.getByText('내용', { exact: true }).locator('..')).toContainText(correctedDescription)

  await page.getByRole('link', { name: '가계부로 돌아가기' }).click()
  await expect(transactionRow(page, originalDescription)).toHaveCount(0)
  await expect(transactionRow(page, correctedDescription).getByText('-65,000원', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '월간 달력' }).click()
  await expect(page.getByTitle('지출 -65,000원', { exact: true })).toBeVisible()
  await expect(page.getByTitle('지출 -90,000원', { exact: true })).toHaveCount(0)
  expect(await hasPageOverflow(page)).toBe(false)

  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expectCardPaymentAmounts(cardAssetRow(page, '신용카드'), { currentMonth: '0원', nextMonth: '65,000원' })
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
  await expect(page.getByLabel('할부 개월')).toBeVisible()
  await page.getByLabel('할부 개월').fill('1')
  await page.getByLabel('내용 (선택)').fill(purchase.description)
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요.')
  await expect(page.getByRole('button', { name: '일별 보기' })).toHaveAttribute('aria-pressed', 'true')
}

function transactionRow(page: Page, description: string) {
  return page.getByRole('listitem').filter({ hasText: description })
}

async function expectDraftAndFocusAcrossViewports(page: Page, field: Locator, value: string, actionName: string) {
  const originalViewport = page.viewportSize()
  await field.focus()
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(field, `${viewport.label}에서 draft가 유지되어야 합니다`).toHaveValue(value)
    await expect(field, `${viewport.label}에서 focus가 유지되어야 합니다`).toBeFocused()
    await expectCardManagementFormLayout(page, viewport.width, actionName === '환불 내용 확인' ? 'refund' : 'correction')
    expect(await hasPageOverflow(page), `${viewport.label}에서 페이지 가로 overflow가 없어야 합니다`).toBe(false)
    await expectTouchTarget(page.getByRole('button', { name: actionName }), `${viewport.label} ${actionName}`)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
  await expect(field).toHaveValue(value)
  await expect(field).toBeFocused()
}

async function expectCardManagementFormLayout(page: Page, width: number, kind: 'refund' | 'correction') {
  const fieldRect = (locator: Locator) => locator.evaluate((element) => {
    const wrapper = element.closest('[data-slot="field"], [data-slot="money-field"]') ?? element.parentElement
    if (!wrapper) throw new Error('카드 관리 Field wrapper를 찾지 못했습니다.')
    const rect = wrapper.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, width: rect.width }
  })
  const [amount, date] = await Promise.all([
    fieldRect(page.getByLabel(kind === 'refund' ? '환불 금액' : '금액', { exact: true })),
    fieldRect(page.getByLabel(kind === 'refund' ? '환불일' : '구매 날짜', { exact: true })),
  ])
  if (width < 768) {
    expect(date.top, `${width}px 날짜는 금액 아래에 있어야 합니다`).toBeGreaterThanOrEqual(amount.bottom - 1)
  } else {
    expect(Math.abs(amount.top - date.top), `${width}px 금액과 날짜는 같은 행에서 시작해야 합니다`).toBeLessThanOrEqual(1)
    expect(amount.width, `${width}px 금액 입력은 날짜보다 넓어야 합니다`).toBeGreaterThan(date.width)
  }
  if (kind === 'refund') return

  const [category, card, installments, performer] = await Promise.all([
    fieldRect(page.getByLabel('분류', { exact: true })),
    fieldRect(page.getByLabel('결제 카드', { exact: true })),
    fieldRect(page.getByLabel('할부 개월', { exact: true })),
    page.getByRole('radiogroup', { name: '누가 썼나요?' }).evaluate((element) => {
      const wrapper = element.closest('[data-slot="performer-picker"]') ?? element.parentElement
      if (!wrapper) throw new Error('카드 관리 PerformerPicker wrapper를 찾지 못했습니다.')
      const rect = wrapper.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, width: rect.width }
    }),
  ])
  if (width < 768) {
    expect(card.top, `${width}px 결제 카드는 분류 아래에 있어야 합니다`).toBeGreaterThanOrEqual(category.bottom - 1)
    expect(installments.top, `${width}px 할부 개월은 결제 카드 아래에 있어야 합니다`).toBeGreaterThanOrEqual(card.bottom - 1)
  } else {
    expect(Math.abs(category.top - card.top), `${width}px 분류와 결제 카드는 같은 맥락 행이어야 합니다`).toBeLessThanOrEqual(1)
    if (width >= 1024) expect(Math.abs(card.top - installments.top), `${width}px 할부는 결제 카드와 같은 행이어야 합니다`).toBeLessThanOrEqual(1)
    else expect(installments.top, `${width}px iPad 세로에서 할부는 좁은 다음 행이어야 합니다`).toBeGreaterThanOrEqual(card.bottom - 1)
  }
  expect(performer.top, `${width}px 사용한 사람은 카드·할부 설정과 다른 독립 행이어야 합니다`).toBeGreaterThanOrEqual(installments.bottom - 1)
}

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} 조작 영역이 보여야 합니다`).not.toBeNull()
  expect(box!.width, `${label} 조작 영역 너비`).toBeGreaterThanOrEqual(44)
  expect(box!.height, `${label} 조작 영역 높이`).toBeGreaterThanOrEqual(44)
}

async function attachSeedManifest(testInfo: TestInfo, page: Page, loginId: string, flow: Record<string, string>) {
  const evidence = evidenceByPage.get(page)
  await testInfo.attach('card-purchase-seed-manifest', {
    body: Buffer.from(JSON.stringify({
      runId: evidence?.runId,
      seedVersion: 'card-purchase-ui-v1',
      loginId,
      timezone: 'Asia/Seoul',
      ...flow,
    }, null, 2)),
    contentType: 'application/json',
  })
}

function currentMonthInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7)
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
