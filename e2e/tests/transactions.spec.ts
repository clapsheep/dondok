import { fillRecordField, showRecordStep } from './support/record-steps'
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

test('모든 원화 입력은 화면 크기에 맞는 계산기로 금액을 입력한다', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number | number[]) => {
        document.documentElement.dataset.lastMoneyKeypadHaptic = JSON.stringify(pattern)
        return true
      },
    })
  })
  await registerAndLogin(page, request, `금액 계산기 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()

  await page.goto('/transactions/new')
  await showRecordStep(page, 3)
  const amount = page.getByLabel('금액', { exact: true })
  await expect(amount).toHaveAttribute('inputmode', 'none')
  const calculator = page.getByRole('dialog', { name: '금액 계산기' })
  if (!await calculator.isVisible()) await amount.click()
  await expect(calculator).toBeVisible()
  await expectResponsiveMoneyCalculator(page, amount, calculator)
  await calculator.getByRole('button', { name: '전체 지우기' }).click()
  await calculator.getByRole('button', { name: '1 입력', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-last-money-keypad-haptic', '10')
  await calculator.getByRole('button', { name: '2 입력', exact: true }).click()
  await calculator.getByRole('button', { name: '0 입력', exact: true }).click()
  await calculator.getByRole('button', { name: '세 자리 0 입력' }).click()
  await expect(amount).toHaveValue('120,000')

  await calculator.getByRole('button', { name: '나누기' }).click()
  await calculator.getByRole('button', { name: '3 입력', exact: true }).click()
  await expect(amount, '계산이 끝나기 전에는 실제 금액을 피연산자로 덮지 않아야 합니다').toHaveValue('120,000')
  await calculator.getByRole('button', { name: '계산 결과 적용' }).click()
  await expect(amount).toHaveValue('40,000')
  await calculator.getByRole('button', { name: '완료' }).click()
  await expect(calculator).toHaveCount(0)
  await expect(amount).toBeFocused()

  await amount.fill('12500')
  await expect(amount, '하드웨어 키보드와 붙여넣기 입력도 계속 지원해야 합니다').toHaveValue('12,500')
})

test('대표 결제는 실제 자산 금액과 월 지출 반영액을 분리한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `대표 결제 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()

  await page.goto('/transactions/new')
  await fillRecordField(page, '금액', '120000')
  const representativeSwitch = page.getByRole('switch', { name: '대표로 결제했어요' })
  await representativeSwitch.click()
  await expect(representativeSwitch).toBeChecked()
  await expect(page.getByLabel('지출로 반영할 금액', { exact: true })).toBeVisible()
  const statisticsAmount = page.getByLabel('지출로 반영할 금액')
  await statisticsAmount.fill('120001')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByText('0원 이상 실제 결제 금액 이하로 입력해 주세요.')).toBeVisible()

  await statisticsAmount.fill('40000')
  await fillRecordField(page, '내용 (선택)', 'QC 대표 결제 식사')
  const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/transactions')
    && response.request().method() === 'POST' && response.status() === 201)
  await page.getByRole('button', { name: '기록 저장' }).click()
  const created = await (await createdResponse).json() as {
    transactionId: string
    amountWon: number
    statisticsAmountWon: number
    postings: Array<{ deltaWon: number }>
  }
  expect(created.amountWon).toBe(120_000)
  expect(created.statisticsAmountWon).toBe(40_000)
  expect(created.postings.map((posting) => posting.deltaWon)).toEqual([-120_000])

  await page.goto(`/transactions/${created.transactionId}`)
  await expect(page.getByRole('heading', { name: '거래 상세' })).toBeVisible()
  await expect(page.getByText('-120,000원', { exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '집계 반영' }).getByText('내 부담', { exact: true }).locator('..').getByText('40,000원', { exact: true })).toBeVisible()

  await page.goto(`/statistics?view=consumption&month=${todayInSeoul().slice(0, 7)}`)
  const monthlySummary = page.getByLabel('월간 자금 사용 요약')
  await expect(monthlySummary.getByText('이번 달 지출', { exact: true }).locator('..').getByText('-40,000원', { exact: true })).toBeVisible()
})

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
  await fillRecordField(page, '금액', '12000')
  await fillRecordField(page, '내용 (선택)', '마지막 자산 기억 지출')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '거래를 기록했어요' })).toBeVisible()

  await page.goto('/transactions/new')
  await showRecordStep(page, 2)
  await expect(page.getByRole('button', { name: '결제 자산', exact: true })).toContainText('계좌')

  await showRecordStep(page, 1)
  await page.getByRole('button', { name: '수입', exact: true }).click()
  await selectAsset(page, '입금 자산', '현금')
  await fillRecordField(page, '금액', '5000')
  await fillRecordField(page, '내용 (선택)', '지출 선호를 바꾸지 않는 수입')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '거래를 기록했어요' })).toBeVisible()

  await page.goto('/transactions/new')
  await showRecordStep(page, 2)
  await expect(page.getByRole('button', { name: '결제 자산', exact: true })).toContainText('계좌')
})

test('수입·지출·이체를 기록하고 월간 합계와 cursor 일별 목록을 같은 의미로 확인한다', { tag: '@pr' }, async ({ page, request }, testInfo) => {
  // 여러 자산·거래 생성과 반응형 검사, cursor seed까지 포함하는 종합 흐름이다.
  test.setTimeout(90_000)
  const displayName = `거래 사용자 ${test.info().workerIndex}`
  const account = await registerAndLogin(page, request, displayName)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()

  await expect(page.getByRole('heading', { name: '구성원', exact: true })).toHaveCount(0)
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()
  const homeHeader = page.locator('[data-home-header]')
  await expect(homeHeader, '홈은 화면 크기와 관계없이 불필요한 가계부 대제목 header를 차지하지 않아야 합니다').toHaveCount(0)
  await expect(page.getByRole('heading', { name: '가계부', level: 1, exact: true })).toBeVisible()
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
  await page.getByRole('link', { name: '자산 추가' }).click()
  await submitQuickAsset(page, {
    typeName: '투자',
    name: '주식 계좌',
    amount: '100000',
    expectedName: '주식 계좌',
    expectedAmount: '100,000원',
  })

  await recordNavigation(page).click()
  await expect(page.getByRole('heading', { name: /^(기록|어떤 거래인가요\?)$/, level: 1 })).toHaveCount(1)
  const dateTrigger = page.getByLabel('날짜', { exact: true })
  await expectResponsiveDatePicker(page, dateTrigger, '날짜')
  const originalDate = await dateTrigger.getAttribute('data-value')
  const adjacentDate = addUtcDays(originalDate!, 1)
  await selectDate(page, '날짜', adjacentDate)
  await expect(dateTrigger).toContainText(displayDate(adjacentDate))
  await selectDate(page, '날짜', originalDate!)
  await page.locator('summary').filter({ hasText: '쓴 사람' }).click()
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
  await showRecordStep(page, 1)
  await page.getByRole('button', { name: '수입', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: '누가 받았나요?' })).toBeVisible()
  await fillRecordField(page, '금액', '200000')
  await expectBankingMoneyPresentation(page.getByLabel('금액', { exact: true }))
  await fillRecordField(page, '내용 (선택)', 'QC 공동 수입')
  await assertDraftAndFocusAcrossWidths(page, 'QC 공동 수입')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '거래를 기록했어요' })).toBeVisible()

  await recordNavigation(page).click()
  await fillRecordField(page, '금액', '7000')
  await fillRecordField(page, '내용 (선택)', 'QC 집계 제외 지출')
  const exclusionSwitch = page.getByRole('switch', { name: '지출에 포함하지 않기' })
  await exclusionSwitch.click()
  await expect(exclusionSwitch).toBeChecked()
  await expect(page.getByText('자산 잔액은 바뀌지만 달력과 통계 합계에는 반영하지 않아요.')).toBeVisible()
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '거래를 기록했어요' })).toBeVisible()

  await recordNavigation(page).click()
  await fillRecordField(page, '금액', '50000')
  await fillRecordField(page, '내용 (선택)', 'QC 공동 지출')
  const addedCategoryName = `QC 즉석 분류 ${test.info().workerIndex}`
  const categoryTrigger = transactionCategoryTrigger(page)
  await showRecordStep(page, 2)
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
  await expect(page.getByLabel('금액', { exact: true })).toHaveValue('50,000')
  await expect(page.getByLabel('내용 (선택)')).toHaveValue('QC 공동 지출')
  await addDialog.getByRole('button', { name: '추가', exact: true }).click()
  await expect(addDialog).toHaveCount(0)
  await expect(categoryTrigger).toContainText(addedCategoryName)
  await expect(categoryTrigger).toBeFocused()
  await showRecordStep(page, 3)
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '거래를 기록했어요' })).toBeVisible()

  await recordNavigation(page).click()
  await page.getByRole('button', { name: '이체', exact: true }).click()
  await page.locator('summary').filter({ hasText: '옮긴 사람' }).click()
  await expect(page.getByRole('radiogroup', { name: '누가 옮겼나요?' })).toBeVisible()
  const sourceAccount = page.getByLabel('보내는 자산')
  const destinationAccount = page.getByLabel('받는 자산')
  const sourcePicker = await openAssetPicker(page, '보내는 자산')
  await expect(sourcePicker.picker.getByRole('button', { name: /^생활비 계좌,/ })).toBeVisible()
  await expect(sourcePicker.picker.getByRole('button', { name: /^현금 지갑,/ })).toBeVisible()
  await expect(sourcePicker.picker.getByRole('button', { name: /^여행 적금,/ })).toBeVisible()
  await expect(sourcePicker.picker.getByRole('button', { name: /^주식 계좌,/ })).toBeVisible()
  await expect(sourcePicker.picker.locator('[data-asset-option]')).not.toHaveCount(0)
  expect(await sourcePicker.picker.locator('[data-asset-option]').evaluateAll((options) => options.every((option) => ['BANK', 'SAVINGS', 'INVESTMENT'].includes(option.getAttribute('data-asset-system-code') ?? '')))).toBe(true)
  await page.keyboard.press('Escape')
  await fillRecordField(page, '금액', '30000')
  await selectAsset(page, '보내는 자산', '주식 계좌')
  await selectAsset(page, '받는 자산', '여행 적금')
  await expect(sourceAccount).toContainText('나')
  await expect(destinationAccount).toContainText('나')
  await fillRecordField(page, '내용 (선택)', 'QC 적금 납입')
  const balancesBeforeTransfer = await currentAssetBalances(page, ['주식 계좌', '여행 적금'])
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '거래를 기록했어요' })).toBeVisible()

  await appNavigation(page, '자산').click()
  await expect(balanceAssetRow(page, '주식 계좌', formatWon(balancesBeforeTransfer['주식 계좌'] - 30_000)), '이체 직후 주식 계좌가 정확히 감소해야 합니다').toBeVisible()
  await expect(balanceAssetRow(page, '여행 적금', formatWon(balancesBeforeTransfer['여행 적금'] + 30_000)), '적금 납입 직후 적금 잔액이 정확히 증가해야 합니다').toBeVisible()
  await appNavigation(page, '홈').click()

  await page.getByRole('button', { name: '월간 달력' }).click()
  await expect(page.locator('[data-home-desktop-summary]').getByText('200,000원', { exact: true })).toBeVisible()
  await expect(page.locator('[data-home-desktop-summary]').getByText('50,000원', { exact: true })).toBeVisible()
  await expect(page.locator('[data-home-desktop-summary]').getByText('150,000원', { exact: true })).toBeVisible()

  const today = todayInSeoul()
  const calendarCell = page.getByRole('gridcell', { name: new RegExp(`수입 \\+200,000원, 지출 -50,000원`) })
  await expect(calendarCell).toBeVisible()
  await expect(calendarCell.getByTitle('수입 +200,000원')).toHaveCSS('color', await cssVariableColor(page, '--calendar-income'))
  await expect(calendarCell.getByTitle('지출 -50,000원')).toHaveCSS('color', await cssVariableColor(page, '--calendar-expense'))
  await expect(calendarCell.getByTitle('합산 거래 2건')).toHaveText('2건')
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
  expect(new URL(page.url()).searchParams.get('date')).toBe(today)
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

  const dayPanel = page.getByRole('complementary', { name: '선택한 날짜의 기록' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await dayPanel.getByRole('link', { name: /에 거래 기록$/ }).click()
  await expect(page).toHaveURL(/\/transactions\/new$/)
  await expect(page.getByLabel('날짜', { exact: true })).toHaveAttribute('data-value', today)
  await page.goBack()
  await expect(page.getByRole('region', { name: `${today} 거래 상세` })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  const previousDay = shiftDate(today, -1)
  await dayPanel.getByRole('button', { name: '이전 날' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(previousDay)
  await dayPanel.getByRole('button', { name: '다음 날' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(today)
  await dayPanel.getByRole('button', { name: '달력으로 돌아가기' }).click()
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeInViewport()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  await expect(dayPanel).toBeVisible()
  await expect(page.getByRole('region', { name: `${today} 거래 상세` })).toBeVisible()
  expect(await hasPageOverflow(page)).toBe(false)

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
  const amount = page.getByLabel('금액', { exact: true })
  const date = page.getByLabel('날짜', { exact: true })
  const category = transactionCategoryTrigger(page)
  const asset = page.getByLabel('입금 자산', { exact: true })
  await expect(amount).toBeVisible()
  if (width < 768) {
    await expect(date).toBeHidden()
    await expect(category).toBeHidden()
    await expect(asset).toBeHidden()
    await expect(page.getByRole('img', { name: '기록 진행: 3단계 중 3단계' })).toBeVisible()
    await expect(page.getByRole('button', { name: '기록 저장', exact: true })).toBeVisible()
  } else {
    const boxes = await Promise.all([date, category, asset, amount].map((field) => field.boundingBox()))
    for(let i=1;i<boxes.length;i++) expect(boxes[i]!.y).toBeGreaterThan(boxes[i-1]!.y)
    expect(boxes[3]!.width).toBeLessThanOrEqual(600)
  }
  await expect(page.locator('[data-transaction-desktop-summary]')).toHaveCount(0)
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
  expect(presentation.fontSize, '승인된 기록 디자인은 금액을 28px로 강조합니다').toBe(28)
  expect(presentation.fontWeight, '금액은 한눈에 읽히는 굵기로 보여야 합니다').toBeGreaterThanOrEqual(600)
  expect(presentation.height, '금액 입력은 모바일 조작 영역을 유지해야 합니다').toBeGreaterThanOrEqual(48)
  expect(presentation.height, '금액 입력은 56px 조작 영역을 사용합니다').toBe(56)
  expect(presentation.textAlign).toBe('left')
  expect(presentation.suffix).toBe('원')
}

async function expectResponsiveMoneyCalculator(page: Page, amount: Locator, calculator: Locator) {
  await expect.poll(() => calculator.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  const viewport = page.viewportSize()
  const amountBox = await amount.boundingBox()
  const calculatorBox = await calculator.boundingBox()
  expect(viewport).not.toBeNull()
  expect(amountBox).not.toBeNull()
  expect(calculatorBox).not.toBeNull()
  if (!viewport || !amountBox || !calculatorBox) return

  if (viewport.width < 768) {
    expect(Math.abs(calculatorBox.x), '모바일 계산기는 화면 왼쪽에 맞닿아야 합니다').toBeLessThanOrEqual(1)
    expect(Math.abs(calculatorBox.width - viewport.width), '모바일 계산기는 화면 폭을 채워야 합니다').toBeLessThanOrEqual(1)
    expect(Math.abs(calculatorBox.y + calculatorBox.height - viewport.height), '모바일 계산기는 키보드처럼 화면 아래에 붙어야 합니다').toBeLessThanOrEqual(16)
    return
  }

  expect(calculatorBox.width, '태블릿·데스크톱 계산기는 입력 근처의 도구창 폭이어야 합니다').toBeLessThanOrEqual(340)
  // 화면 아래 공간이 부족하면 Base UI가 입력 옆으로 배치한다.
  const side = await calculator.getAttribute('data-side')
  if (side === 'left' || side === 'right') {
    const gap = side === 'right' ? calculatorBox.x - (amountBox.x + amountBox.width) : amountBox.x - (calculatorBox.x + calculatorBox.width)
    expect(Math.abs(gap), '계산기는 금액 입력 바로 옆에 있어야 합니다').toBeLessThanOrEqual(16)
  } else {
    expect(Math.abs(calculatorBox.x - amountBox.x), '계산기는 금액 입력 왼쪽에 정렬되어야 합니다').toBeLessThanOrEqual(8)
    const gap = side === 'top' ? amountBox.y - (calculatorBox.y + calculatorBox.height) : calculatorBox.y - (amountBox.y + amountBox.height)
    expect(Math.abs(gap), '계산기는 금액 입력 바로 위나 아래에 있어야 합니다').toBeLessThanOrEqual(16)
  }
  expect(calculatorBox.x).toBeGreaterThanOrEqual(0)
  expect(calculatorBox.y).toBeGreaterThanOrEqual(0)
  expect(calculatorBox.x + calculatorBox.width).toBeLessThanOrEqual(viewport.width)
  expect(calculatorBox.y + calculatorBox.height).toBeLessThanOrEqual(viewport.height)
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

async function cssVariableColor(page: Page, name: '--calendar-income' | '--calendar-expense') {
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
