import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { balanceAssetRow, submitQuickAsset } from './support/assets'
import { expectResponsiveAssetPicker, openAssetPicker, selectAsset } from './support/asset-picker'
import { registerAndLogin } from './support/auth'
import { expectResponsiveDatePicker, selectDate } from './support/date-picker'
import { transactionCategoryTrigger } from './support/transactions'

type SeedResult = {
  assets: string[]
  memberId: string
  requestIds: string[]
}

test.use({ serviceWorkers: 'block' })

test('카드 선택기는 가장 가까운 결제 예정액을 보여준다', async ({ page, request }) => {
  await registerAndLogin(page, request, `카드 선택 금액 ${test.info().workerIndex}`)
  await page.route('**/api/assets', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const assets = await response.json() as Array<{
      behavior: string
      nearestCardPaymentDueOn: string | null
      nearestCardPaymentDueWon: number
    }>
    await route.fulfill({ response, json: assets.map((asset) => asset.behavior === 'CREDIT_CARD' ? {
      ...asset,
      nearestCardPaymentDueOn: '2026-08-25',
      nearestCardPaymentDueWon: 210_000,
    } : asset) })
  })
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()

  await page.goto('/transactions/new')
  const { trigger, picker } = await openAssetPicker(page, '결제 자산')
  await picker.getByRole('button', { name: /^카드 \d+$/ }).click()
  const creditCard = picker.getByRole('button', { name: /^신용카드, (?:기타 카드사, )?신용카드, 나, 결제 예정 210,000원$/ })
  await expect(creditCard).toBeVisible()
  await creditCard.click()
  await expect(trigger).toContainText('결제 예정 210,000원')
})

test('마지막으로 지출한 자산을 다음 지출의 기본값으로 기억한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `마지막 지출 자산 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()

  await page.goto('/transactions/new')
  await selectAsset(page, '결제 자산', '계좌')
  await page.getByLabel('금액').fill('12000')
  await page.getByLabel('내용 (선택)').fill('마지막 자산 기억 지출')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  await page.goto('/transactions/new')
  await expect(page.getByRole('button', { name: '결제 자산', exact: true })).toContainText('계좌')

  await page.getByRole('button', { name: '수입', exact: true }).click()
  await selectAsset(page, '입금 자산', '현금')
  await page.getByLabel('금액').fill('5000')
  await page.getByLabel('내용 (선택)').fill('지출 선호를 바꾸지 않는 수입')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  await page.goto('/transactions/new')
  await expect(page.getByRole('button', { name: '결제 자산', exact: true })).toContainText('계좌')
})

test('수입·지출·이체를 기록하고 월간 합계와 cursor 일별 목록을 같은 의미로 확인한다', async ({ page, request }, testInfo) => {
  const displayName = `거래 사용자 ${test.info().workerIndex}`
  const account = await registerAndLogin(page, request, displayName)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()

  await expect(page.getByRole('heading', { name: '구성원', exact: true })).toHaveCount(0)
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()
  const homeHeader = page.locator('[data-home-header]')
  await expect(homeHeader, '홈은 화면 크기와 관계없이 불필요한 가계부 대제목 header를 차지하지 않아야 합니다').toHaveCount(0)
  await expect(page.getByRole('heading', { name: '가계부', level: 1, exact: true })).toHaveClass(/sr-only/)
  if ((page.viewportSize()?.width ?? 768) < 768) await pullHomeToRefresh(page)
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()
  await createBankAsset(page, '생활비 계좌', '1000000')
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()
  await createBankAsset(page, '현금 지갑', '100000')
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()
  await submitQuickAsset(page, {
    typeName: '적금',
    name: '여행 적금',
    amount: '0',
    expectedName: '여행 적금',
    expectedAmount: '0원',
  })

  await recordNavigation(page).click()
  await expect(page.getByRole('heading', { name: '거래 기록', level: 1 })).toHaveCount(1)
  const dateTrigger = page.getByLabel('날짜', { exact: true })
  await expectResponsiveDatePicker(page, dateTrigger, '날짜')
  const originalDate = await dateTrigger.getAttribute('data-value')
  const adjacentDate = addUtcDays(originalDate!, 1)
  await selectDate(page, '날짜', adjacentDate)
  await expect(dateTrigger).toContainText(displayDate(adjacentDate))
  await selectDate(page, '날짜', originalDate!)
  await expect(page.getByRole('radiogroup', { name: '누가 썼나요?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: new RegExp(displayName) })).toBeChecked()
  await expect(page.getByRole('radiogroup', { name: '누가 썼나요?' }).locator('[data-member-avatar]')).toHaveAttribute('data-member-initial', '거')
  const assetPicker = await openAssetPicker(page, '결제 자산')
  await expect(assetPicker.picker.getByRole('group', { name: '자산 종류 필터' })).toBeVisible()
  await expect(assetPicker.picker.getByRole('button', { name: /^전체 \d+$/ })).toBeVisible()
  await expect(assetPicker.picker.getByRole('button', { name: /^자금 \d+$/ })).toBeVisible()
  await expect.poll(() => assetPicker.picker.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  const pickerBoxBeforeFilter = await assetPicker.picker.boundingBox()
  await assetPicker.picker.getByRole('button', { name: /^카드 \d+$/ }).click()
  await expect(assetPicker.picker.locator('[data-asset-option]')).toHaveCount(2)
  expect(await assetPicker.picker.locator('[data-asset-option]').evaluateAll((options) => options.every((option) => ['CREDIT_CARD', 'DEBIT_CARD'].includes(option.getAttribute('data-asset-system-code') ?? '')))).toBe(true)
  const pickerBoxAfterFilter = await assetPicker.picker.boundingBox()
  if ((page.viewportSize()?.width ?? 768) < 768) {
    expect(pickerBoxBeforeFilter).not.toBeNull()
    expect(pickerBoxAfterFilter).not.toBeNull()
    expect(Math.abs(pickerBoxAfterFilter!.height - pickerBoxBeforeFilter!.height), '모바일 자산 종류를 바꿔도 drawer 높이는 움직이지 않아야 합니다').toBeLessThanOrEqual(1)
    expect(Math.abs(pickerBoxAfterFilter!.y - pickerBoxBeforeFilter!.y), '모바일 자산 종류를 바꿔도 drawer 위쪽 위치는 움직이지 않아야 합니다').toBeLessThanOrEqual(1)
  }
  await expect(assetPicker.picker.locator('[data-member-avatar]')).not.toHaveCount(0)
  await expectResponsiveAssetPicker(page, assetPicker.trigger, assetPicker.picker)
  await page.keyboard.press('Escape')
  await expect(assetPicker.picker).toHaveCount(0)
  await expect(assetPicker.trigger).toBeFocused()
  await page.getByRole('button', { name: '수입', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: '누가 받았나요?' })).toBeVisible()
  await page.getByLabel('금액').fill('200000')
  await expectBankingMoneyPresentation(page.getByLabel('금액'))
  await page.getByLabel('내용 (선택)').fill('QC 공동 수입')
  await assertDraftAndFocusAcrossWidths(page, 'QC 공동 수입')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  await recordNavigation(page).click()
  await page.getByLabel('금액').fill('7000')
  await page.getByLabel('내용 (선택)').fill('QC 집계 제외 지출')
  const exclusionSwitch = page.getByRole('switch', { name: '지출에 포함하지 않기' })
  await exclusionSwitch.click()
  await expect(exclusionSwitch).toBeChecked()
  await expect(page.getByText('자산 잔액은 바뀌지만 달력과 통계 합계에는 반영하지 않아요.')).toBeVisible()
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  await recordNavigation(page).click()
  await page.getByLabel('금액').fill('50000')
  await page.getByLabel('내용 (선택)').fill('QC 공동 지출')
  const addedCategoryName = `QC 즉석 분류 ${test.info().workerIndex}`
  const categoryTrigger = transactionCategoryTrigger(page)
  await categoryTrigger.click()
  const categoryDialog = page.getByRole('dialog', { name: '지출 분류 선택' })
  await expect(categoryDialog).toBeVisible()
  await expect(categoryDialog.getByRole('button', { name: '식비', exact: true })).toBeVisible()
  await expect(categoryDialog.getByRole('button', { name: '항목 추가', exact: true })).toBeVisible()
  await expectBottomDrawerOnMobile(page, categoryDialog)
  await categoryDialog.getByRole('button', { name: '항목 추가', exact: true }).click()
  const addDialog = page.getByRole('dialog', { name: '지출 분류 추가' })
  const categoryName = addDialog.getByRole('textbox', { name: '항목 이름' })
  await expect(categoryName).toBeFocused()
  await categoryName.fill(addedCategoryName)
  await expect(page.getByLabel('금액')).toHaveValue('50,000')
  await expect(page.getByLabel('내용 (선택)')).toHaveValue('QC 공동 지출')
  await addDialog.getByRole('button', { name: '추가', exact: true }).click()
  await expect(addDialog).toHaveCount(0)
  await expect(categoryTrigger).toContainText(addedCategoryName)
  await expect(categoryTrigger).toBeFocused()
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  await recordNavigation(page).click()
  await page.getByRole('button', { name: '이체', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: '누가 옮겼나요?' })).toBeVisible()
  const sourceAccount = page.getByLabel('보내는 자산')
  const destinationAccount = page.getByLabel('받는 자산')
  const sourcePicker = await openAssetPicker(page, '보내는 자산')
  await expect(sourcePicker.picker.getByRole('button', { name: /^생활비 계좌,/ })).toBeVisible()
  await expect(sourcePicker.picker.getByRole('button', { name: /^현금 지갑,/ })).toBeVisible()
  await expect(sourcePicker.picker.getByRole('button', { name: /^여행 적금,/ })).toBeVisible()
  await expect(sourcePicker.picker.locator('[data-asset-option]')).not.toHaveCount(0)
  expect(await sourcePicker.picker.locator('[data-asset-option]').evaluateAll((options) => options.every((option) => ['BANK', 'SAVINGS'].includes(option.getAttribute('data-asset-system-code') ?? '')))).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByLabel('금액').fill('30000')
  await selectAsset(page, '보내는 자산', '생활비 계좌')
  await selectAsset(page, '받는 자산', '여행 적금')
  await expect(sourceAccount).toContainText('나')
  await expect(destinationAccount).toContainText('나')
  await page.getByLabel('내용 (선택)').fill('QC 적금 납입')
  const balancesBeforeTransfer = await currentAssetBalances(page, ['생활비 계좌', '여행 적금'])
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  await appNavigation(page, '자산').click()
  await expect(balanceAssetRow(page, '생활비 계좌', formatWon(balancesBeforeTransfer['생활비 계좌'] - 30_000)), '이체 직후 출금 계좌가 정확히 감소해야 합니다').toBeVisible()
  await expect(balanceAssetRow(page, '여행 적금', formatWon(balancesBeforeTransfer['여행 적금'] + 30_000)), '적금 납입 직후 적금 잔액이 정확히 증가해야 합니다').toBeVisible()
  await appNavigation(page, '홈').click()

  await page.getByRole('button', { name: '월간 달력' }).click()
  await expect(page.getByTitle('+200,000원', { exact: true })).toBeVisible()
  await expect(page.getByTitle('-50,000원', { exact: true })).toBeVisible()
  await expect(page.getByTitle('+150,000원', { exact: true })).toBeVisible()

  const today = todayInSeoul()
  const calendarCell = page.getByRole('gridcell', { name: new RegExp(`수입 \\+200,000원, 지출 -50,000원`) })
  await expect(calendarCell).toBeVisible()
  await expect(calendarCell.getByTitle('수입 +200,000원')).toHaveCSS('color', await cssVariableColor(page, '--income'))
  await expect(calendarCell.getByTitle('지출 -50,000원')).toHaveCSS('color', await cssVariableColor(page, '--expense'))
  await expect(calendarCell).toHaveCSS('border-radius', '0px')
  const calendarAmounts = calendarCell.locator('[title^="수입 "], [title^="지출 "]')
  await expect(calendarAmounts).toHaveCount(2)
  const originalViewport = page.viewportSize()
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await expectCalendarAmountsFit(page, calendarAmounts)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)

  await calendarCell.getByRole('button').click()
  expect(new URL(page.url()).searchParams.get('date')).toBe(today)
  expect(new URL(page.url()).searchParams.get('detail')).toBe('day')
  let selectedDayDetail = page.getByRole('region', { name: `${today} 거래 상세` })
  await expect(selectedDayDetail).toBeVisible()
  const selectedIncome = selectedDayDetail.getByRole('listitem').filter({ hasText: 'QC 공동 수입' })
  const selectedExpense = selectedDayDetail.getByRole('listitem').filter({ hasText: 'QC 공동 지출' })
  const selectedExcludedExpense = selectedDayDetail.getByRole('listitem').filter({ hasText: 'QC 집계 제외 지출' })
  await expect(selectedIncome.getByText('+200,000원', { exact: true })).toBeVisible()
  await expect(selectedExpense.getByText('-50,000원', { exact: true })).toBeVisible()
  await expect(selectedExpense.getByText(addedCategoryName, { exact: true })).toBeVisible()
  await expect(selectedExcludedExpense.getByText('-7,000원', { exact: true })).toBeVisible()
  await expect(selectedExcludedExpense.getByText('집계 제외', { exact: true })).toBeVisible()

  const dayDialog = page.getByRole('dialog')
  const recordSelectedDay = dayDialog.getByRole('link', { name: /에 거래 기록$/ })
  await expect(recordSelectedDay).toBeVisible()
  await recordSelectedDay.click()
  await expect(page).toHaveURL(/\/transactions\/new$/)
  await expect(page.getByLabel('날짜', { exact: true })).toHaveAttribute('data-value', today)
  await page.goBack()
  await expect(page.getByRole('region', { name: `${today} 거래 상세` })).toBeVisible()
  await assertDayDetailLayout(page, dayDialog, 390)
  const previousDay = shiftDate(today, -1)
  await dayDialog.getByRole('button', { name: '이전 날' }).click()
  expect(new URL(page.url()).searchParams.get('date')).toBe(previousDay)
  selectedDayDetail = page.getByRole('region', { name: `${previousDay} 거래 상세` })
  await expect(selectedDayDetail).toBeVisible()
  await dayDialog.getByRole('button', { name: '다음 날' }).click()
  expect(new URL(page.url()).searchParams.get('date')).toBe(today)
  await assertDayDetailLayout(page, dayDialog, 1280)
  await dayDialog.getByRole('button', { name: '달력으로 돌아가기' }).click()
  await expect(dayDialog).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('detail')).toBeNull()

  await calendarCell.getByRole('button').click()
  await page.reload()
  await expect(page.getByRole('region', { name: `${today} 거래 상세` })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('detail')).toBeNull()

  await calendarCell.getByRole('button').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).searchParams.get('detail')).toBeNull()

  const listRequests: string[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (response.request().method() === 'GET' && url.pathname === '/api/transactions') listRequests.push(url.toString())
  })
  const seed = await seedCursorTransfers(page, today, 51)
  await attachSeedEvidence(testInfo, account.loginId, seed)

  const month = today.slice(0, 7)
  await page.goto(`/?view=daily&month=${month}`)
  await expect(page.getByRole('button', { name: '일별 보기' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('QC cursor 50', { exact: true })).toBeVisible()
  await expect(page.getByText('QC cursor 00', { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByText('QC cursor 00', { exact: true })).toBeVisible()

  for (let index = 0; index < 51; index += 1) {
    await expect(page.getByText(`QC cursor ${String(index).padStart(2, '0')}`, { exact: true })).toHaveCount(1)
  }
  await expect(page.getByText('QC 공동 수입', { exact: true })).toBeVisible()
  await expect(page.getByText('QC 공동 지출', { exact: true })).toBeVisible()
  await expect(page.getByText('QC 집계 제외 지출', { exact: true })).toBeVisible()
  await expect(page.getByText('QC 적금 납입', { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 공동 수입').getByText('+200,000원', { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 공동 지출').getByText('-50,000원', { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 공동 지출').getByText(addedCategoryName, { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 집계 제외 지출').getByText('-7,000원', { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 집계 제외 지출').getByText('집계 제외', { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 적금 납입').getByText('30,000원', { exact: true })).toBeVisible()
  await expect(transactionRow(page, 'QC 공동 지출').locator('[data-member-avatar]')).toHaveAttribute('data-member-initial', '거')

  expect(listRequests.length).toBeGreaterThanOrEqual(2)
  expect(listRequests.some((url) => new URL(url).searchParams.has('cursor'))).toBe(true)
  expect(await hasPageOverflow(page)).toBe(false)
  await expect(page.locator('main li').first()).toHaveCSS('border-radius', '0px')

  await transactionRow(page, 'QC 공동 지출').getByRole('link').click()
  await page.getByRole('link', { name: '기록 편집' }).click()
  await expect(transactionCategoryTrigger(page)).toContainText(addedCategoryName)
})

async function createBankAsset(page: Page, name: string, openingBalance: string) {
  const row = await submitQuickAsset(page, {
    typeName: '계좌',
    name,
    amount: openingBalance,
    expectedName: name,
    expectedAmount: `${Number(openingBalance).toLocaleString('ko-KR')}원`,
  })
  await row.getByRole('link').click()
  await page.getByRole('link', { name: '자산 편집' }).click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue(name)
}

function recordNavigation(page: Page) {
  return appNavigation(page, '기록')
}

function appNavigation(page: Page, label: '홈' | '기록' | '자산') {
  const mobile = page.getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('link', { name: label, exact: true })
  const wide = page.getByRole('complementary', { name: '주요 메뉴' })
    .getByRole('link', { name: label, exact: true })
  return mobile.or(wide)
}

function transactionRow(page: Page, description: string) {
  return page.getByRole('listitem').filter({ hasText: description })
}

async function pullHomeToRefresh(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const home = page.locator('[data-home-ledger]')
  const indicator = page.locator('[data-pull-to-refresh]')
  const dispatchTouch = (type: 'touchstart' | 'touchmove' | 'touchend', clientY?: number) => home.evaluate((element, detail) => {
    const event = new Event(detail.type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'touches', { value: detail.clientY === undefined ? [] : [{ clientY: detail.clientY }] })
    element.dispatchEvent(event)
  }, { type, clientY })

  await dispatchTouch('touchstart', 100)
  await dispatchTouch('touchmove', 260)
  await expect(indicator).toContainText('놓아서 새로고침')

  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname === '/api/transactions/calendar'
  })
  await dispatchTouch('touchend')
  await refreshed
}

async function expectBottomDrawerOnMobile(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  if (viewport && viewport.width < 768) {
    expect(Math.abs(box!.y + box!.height - viewport.height)).toBeLessThanOrEqual(1)
    expect(box!.width).toBe(viewport.width)
  }
}

async function assertDayDetailLayout(page: Page, dialog: Locator, width: number) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  if (width < 768) {
    expect(Math.abs(box!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.width - width)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.height - 844)).toBeLessThanOrEqual(1)
    await expect(dialog).toHaveCSS('border-radius', '0px')
  } else {
    expect(box!.x).toBeGreaterThan(0)
    expect(box!.y).toBeGreaterThan(0)
    expect(box!.width).toBeLessThan(width)
    expect(box!.height).toBeLessThan(900)
    expect(parseFloat(await dialog.evaluate((element) => getComputedStyle(element).borderRadius))).toBeLessThanOrEqual(8)
  }
  expect(await hasPageOverflow(page)).toBe(false)
}

function shiftDate(date: string, offset: number) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10)
}

async function assertDraftAndFocusAcrossWidths(page: Page, description: string) {
  const field = page.getByLabel('내용 (선택)')
  const originalViewport = page.viewportSize()
  await field.focus()
  for (const width of [320, 507, 767, 768, 769, 1023, 1024, 1025, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 760 : 900 })
    await expect(field).toHaveValue(description)
    await expect(field).toBeFocused()
    await expectTransactionFormLayout(page, width)
    expect(await hasPageOverflow(page)).toBe(false)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
}

async function expectTransactionFormLayout(page: Page, width: number) {
  const continuousFlow = page.locator('[data-transaction-fields]')
  const fieldRect = (locator: Locator) => locator.evaluate((element) => {
    const wrapper = element.closest('[data-slot="field"], [data-slot="money-field"]') ?? element.parentElement
    if (!wrapper) throw new Error('거래 Field wrapper를 찾지 못했습니다.')
    const rect = wrapper.getBoundingClientRect()
    const control = wrapper.querySelector<HTMLElement>('input, button, select')
    return { top: rect.top, bottom: rect.bottom, width: rect.width, controlHeight: control?.getBoundingClientRect().height ?? 0 }
  })
  const [amount, date, category, asset] = await Promise.all([
    fieldRect(page.getByLabel('금액', { exact: true })),
    fieldRect(page.getByLabel('날짜', { exact: true })),
    fieldRect(transactionCategoryTrigger(page)),
    fieldRect(page.getByLabel('입금 자산', { exact: true })),
  ])
  expect(date.top, `${width}px 날짜는 금액 다음 독립 행에 있어야 합니다`).toBeGreaterThanOrEqual(amount.bottom - 1)
  expect(amount.top, `${width}px 거래 입력은 금액부터 읽혀야 합니다`).toBeLessThan(date.top)
  expect(Math.abs(amount.width - date.width), `${width}px 금액과 날짜는 같은 전체 폭을 사용해야 합니다`).toBeLessThanOrEqual(1)
  expect(Math.abs(amount.controlHeight - date.controlHeight), `${width}px 금액과 날짜 control 높이가 같아야 합니다`).toBeLessThanOrEqual(1)
  expect(asset.top, `${width}px 자산은 분류 다음 독립 행에 있어야 합니다`).toBeGreaterThanOrEqual(category.bottom - 1)
  expect(await continuousFlow.evaluate((element) => [...element.children].filter((child) => {
    const style = getComputedStyle(child)
    return parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0
  }).length), `${width}px 관련 없는 입력을 두 개씩 묶는 반복 구분선이 없어야 합니다`).toBe(0)
  if (width >= 1024) expect(amount.width, `${width}px 데스크톱 입력 열은 과도하게 늘어나지 않아야 합니다`).toBeLessThanOrEqual(640)

  const mobileContextHeader = page.locator('[data-mobile-context-header]')
  const pageBackLink = page.getByRole('link', { name: '가계부로 돌아가기', exact: true })
  const desktopSummary = page.locator('[data-transaction-desktop-summary]')
  await expect(pageBackLink, `${width}px 하단 기록 탭으로 여는 새 거래 화면에 가계부 복귀 링크를 만들면 안 됩니다`).toHaveCount(0)
  if (width < 768) {
    await expect(mobileContextHeader, `${width}px 최상위 기록 탭에 뒤로가기용 문맥 header를 만들면 안 됩니다`).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '거래 기록', level: 1 })).toBeVisible()
    await expect(desktopSummary).toBeHidden()
    const navGeometry = await page.locator('[data-mobile-navigation]').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        left: rect.left,
        right: rect.right,
        bottom: innerHeight - rect.bottom,
        radius: Math.max(parseFloat(style.borderTopLeftRadius), parseFloat(style.borderTopRightRadius)),
      }
    })
    expect(navGeometry.left, `${width}px 하단 navigation은 화면 가장자리에 붙지 않아야 합니다`).toBeGreaterThanOrEqual(8)
    expect(navGeometry.right, `${width}px 하단 navigation은 오른쪽 가장자리에 붙지 않아야 합니다`).toBeLessThanOrEqual(width - 8)
    expect(navGeometry.bottom, `${width}px 하단 navigation은 기기 하단 edge와 간격을 둬야 합니다`).toBeGreaterThanOrEqual(8)
    expect(navGeometry.radius, `${width}px 하단 navigation은 둥근 기기 edge에 맞는 곡률을 가져야 합니다`).toBeGreaterThanOrEqual(16)
    return
  }
  await expect(mobileContextHeader).toBeHidden()
  if (width >= 1024) {
    await expect(desktopSummary, `${width}px 데스크톱은 현재 입력 요약 rail을 보여야 합니다`).toBeVisible()
    await expect(desktopSummary, `${width}px 요약 rail은 같은 거래 draft의 금액을 즉시 반영해야 합니다`).toContainText('200,000원')
  }
  else await expect(desktopSummary).toBeHidden()
}

function addUtcDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function displayDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return `${year}. ${month}. ${day}.`
}

async function expectBankingMoneyPresentation(amount: Locator) {
  const presentation = await amount.evaluate((element) => {
    const style = getComputedStyle(element)
    const wrapper = element.closest('[data-slot="money-field"]')
    return {
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
      height: element.getBoundingClientRect().height,
      textAlign: style.textAlign,
      suffix: wrapper?.querySelector('[aria-hidden="true"]')?.textContent,
    }
  })
  expect(presentation.fontSize, '금액은 compact 강조 크기여야 합니다').toBeGreaterThanOrEqual(18)
  expect(presentation.fontSize, '금액 글자가 날짜보다 과도하게 커지면 안 됩니다').toBeLessThanOrEqual(20)
  expect(presentation.fontWeight, '금액은 한눈에 읽히는 굵기로 보여야 합니다').toBeGreaterThanOrEqual(600)
  expect(presentation.height, '금액 입력은 모바일 조작 영역을 유지해야 합니다').toBeGreaterThanOrEqual(48)
  expect(presentation.height, '금액 입력이 날짜보다 과도하게 높아지면 안 됩니다').toBeLessThanOrEqual(50)
  expect(presentation.textAlign).toBe('right')
  expect(presentation.suffix).toBe('원')
}

async function seedCursorTransfers(page: Page, occurredOn: string, count: number): Promise<SeedResult> {
  return page.evaluate(async ({ occurredOn, count }) => {
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const assets = await requiredJson<Array<{ assetId: string; systemCode: string }>>('/api/assets')
    const accounts = assets.filter((asset) => asset.systemCode === 'BANK')
    const current = await requiredJson<{ ledger: { members: Array<{ memberId: string; currentUser: boolean }> } }>('/api/ledger-books/current')
    if (accounts.length < 2) throw new Error('cursor seed requires two bank accounts')
    const memberId = current.ledger.members.find((member) => member.currentUser)?.memberId
    if (!memberId) throw new Error('current ledger member was not found')
    const requestIds: string[] = []
    for (let index = 0; index < count; index += 1) {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          [csrf.headerName]: csrf.token,
          'Idempotency-Key': crypto.randomUUID(),
          'X-E2E-Run-Id': `transaction-cursor-${occurredOn}`,
          'X-E2E-Test-Id': 'transactions-cursor-continuity',
        },
        body: JSON.stringify({
          type: 'TRANSFER',
          occurredOn,
          amountWon: index + 1,
          sourceAssetId: accounts[0].assetId,
          destinationAssetId: accounts[1].assetId,
          performedByMemberId: memberId,
          description: `QC cursor ${String(index).padStart(2, '0')}`,
        }),
      })
      if (!response.ok) throw new Error(`cursor transaction ${index} returned ${response.status}`)
      const requestId = response.headers.get('X-Request-Id')
      if (requestId) requestIds.push(requestId)
    }
    return { assets: accounts.slice(0, 2).map((asset) => asset.assetId), memberId, requestIds }
  }, { occurredOn, count })
}

async function attachSeedEvidence(testInfo: TestInfo, loginId: string, seed: SeedResult) {
  await testInfo.attach('transaction-seed-manifest', {
    body: Buffer.from(JSON.stringify({ seedVersion: 'transaction-ui-v1', loginId, ...seed }, null, 2)),
    contentType: 'application/json',
  })
}

async function cssVariableColor(page: Page, name: '--income' | '--expense') {
  return page.evaluate((variable) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)
}

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

async function expectCalendarAmountsFit(page: Page, amounts: Locator) {
  for (const amount of await amounts.all()) {
    const presentation = await amount.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      textOverflow: getComputedStyle(element).textOverflow,
    }))
    expect(presentation.textOverflow, '달력 금액은 말줄임표로 숨기면 안 됩니다').not.toBe('ellipsis')
    expect(presentation.scrollWidth, '달력 금액은 날짜 셀 폭 안에서 전부 보여야 합니다').toBeLessThanOrEqual(presentation.clientWidth)
  }
  expect(await hasPageOverflow(page)).toBe(false)
}

async function currentAssetBalances(page: Page, names: string[]) {
  return page.evaluate(async (assetNames) => {
    const response = await fetch('/api/assets?status=ALL', { credentials: 'include' })
    if (!response.ok) throw new Error(`asset balance request returned ${response.status}`)
    const assets = await response.json() as Array<{ name: string; currentBalanceWon: number }>
    return Object.fromEntries(assetNames.map((name) => {
      const asset = assets.find((candidate) => candidate.name === name)
      if (!asset) throw new Error(`asset was not found: ${name}`)
      return [name, asset.currentBalanceWon]
    }))
  }, names)
}

function formatWon(value: number) {
  return `${value.toLocaleString('ko-KR')}원`
}

function todayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
