import { expect, test, type Locator, type Page } from '@playwright/test'
import { balanceAssetRow, cardAssetRow, expectCardPaymentAmounts, openQuickAssetDetail } from './support/assets'
import { selectAsset } from './support/asset-picker'
import { registerAndLogin } from './support/auth'
import { expectInputBodyOpensDatePicker } from './support/date-picker'

const RESPONSIVE_WIDTHS = [320, 360, 390, 768, 1024, 1280]

test.use({ serviceWorkers: 'block' })

async function expectFlatStructure(locator: Locator, label: string) {
  await expect(locator, `${label} 구조가 보여야 합니다`).toBeVisible()
  const style = await locator.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      radius: Math.max(
        parseFloat(computed.borderTopLeftRadius),
        parseFloat(computed.borderTopRightRadius),
        parseFloat(computed.borderBottomRightRadius),
        parseFloat(computed.borderBottomLeftRadius),
      ),
      shadow: computed.boxShadow,
    }
  })
  expect(style.radius, `${label}에 카드형 모서리가 남아 있습니다`).toBe(0)
  expect(style.shadow, `${label}에 카드형 그림자가 남아 있습니다`).toBe('none')
}

async function expectQuickCreateFields(page: Page, amountLabel: '기준일 잔액' | '기준일 대출 잔액') {
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toBeVisible()
  await expect(page.getByLabel(amountLabel, { exact: true })).toBeVisible()
  await expect(page.getByLabel('잔액 기준일', { exact: true })).toHaveValue(todayInSeoul())
  for (const hiddenField of [
    page.getByRole('group', { name: '소유 형태', exact: true }),
    page.getByRole('radiogroup', { name: '소유자', exact: true }),
    page.getByLabel('메모 (선택)', { exact: true }),
  ]) await expect(hiddenField, '빠른 등록 화면에는 상세 필드를 노출하지 않아야 합니다').toHaveCount(0)
}

async function expectTypeGrid(page: Page, group: Locator, width: number) {
  const layout = await group.getByRole('button').evaluateAll((buttons) => {
    const groupElement = buttons[0]?.closest('fieldset, [role="group"]')
    const groupRect = groupElement?.getBoundingClientRect()
    return {
      groupOverflow: groupElement ? groupElement.scrollWidth > groupElement.clientWidth + 1 : true,
      rowCount: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
      columnCount: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().left))).size,
      outsideGroup: buttons.some((button) => {
        if (!groupRect) return true
        const rect = button.getBoundingClientRect()
        return rect.left < groupRect.left - 1 || rect.right > groupRect.right + 1
      }),
    }
  })
  expect(layout.groupOverflow, `${width}px에서 자산 종류 그룹이 가로로 넘치면 안 됩니다`).toBe(false)
  expect(layout.outsideGroup, `${width}px에서 자산 종류 버튼이 그룹 밖으로 나가면 안 됩니다`).toBe(false)
  if (width < 640) {
    expect(layout.columnCount, `${width}px 자산 종류는 3열이어야 합니다`).toBe(3)
    expect(layout.rowCount, `${width}px 자산 종류 9개는 3행이어야 합니다`).toBe(3)
  }
  if (width >= 768) {
    expect(layout.columnCount, `${width}px 자산 종류는 5열이어야 합니다`).toBe(5)
    expect(layout.rowCount, `${width}px 자산 종류는 2행이어야 합니다`).toBe(2)
  }
}

async function expectQuickCreateAcrossBreakpoints(
  page: Page,
  typeGroup: Locator,
  selectedButton: Locator,
  amountLabel: '기준일 잔액' | '기준일 대출 잔액',
  amount: string,
) {
  const nameField = page.getByLabel('자산 이름 (선택)', { exact: true })
  const amountField = page.getByLabel(amountLabel, { exact: true })
  const openedOn = page.getByLabel('잔액 기준일', { exact: true })
  const nameDraft = await nameField.inputValue()
  const openedOnDraft = await openedOn.inputValue()
  await selectedButton.focus()
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 820 : 900 })
    await expectQuickCreateFields(page, amountLabel)
    await expect(nameField, `${width}px에서 자산 이름 draft를 보존해야 합니다`).toHaveValue(nameDraft)
    await expect(amountField, `${width}px에서 금액 draft를 보존해야 합니다`).toHaveValue(formatInputWon(amount))
    await expect(openedOn, `${width}px에서 잔액 기준일 draft를 보존해야 합니다`).toHaveValue(openedOnDraft)
    await expect(selectedButton, `${width}px에서 자산 종류 focus를 보존해야 합니다`).toBeFocused()
    await expect(selectedButton, `${width}px에서 자산 종류 선택을 보존해야 합니다`).toHaveAttribute('aria-pressed', 'true')
    await expectTypeGrid(page, typeGroup, width)
    if (width < 768) await expectAmountAndDateControlsStacked(page, amountLabel, width)
    else await expectAmountAndDateControlsAligned(page, amountLabel, width)
    await expectFormTargetsAtLeast44(page, typeGroup, [
      [nameField, '자산 이름'],
      [amountField, amountLabel],
      [openedOn, '잔액 기준일'],
      [page.getByRole('link', { name: '취소' }), '취소'],
      [page.getByRole('button', { name: '자산 등록', exact: true }), '자산 등록'],
    ], width)
    expect(await hasPageOverflow(page), `${width}px에서 가로 overflow가 없어야 합니다`).toBe(false)
  }
}

async function expectDetailAcrossBreakpoints(
  page: Page,
  typeGroup: Locator,
  selectedButton: Locator,
  amountLabel: '기준일 잔액' | '기준일 대출 잔액',
  amount: string,
  memoDraft: string,
) {
  const memo = page.getByLabel('메모 (선택)', { exact: true })
  await memo.fill(memoDraft)
  await selectedButton.focus()
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 820 : 900 })
    for (const field of [
      page.getByLabel('자산 이름 (선택)', { exact: true }),
      page.getByRole('group', { name: '소유 형태', exact: true }),
      page.getByRole('radiogroup', { name: '소유자', exact: true }),
      page.getByLabel(amountLabel, { exact: true }),
      page.getByLabel('잔액 기준일', { exact: true }),
      memo,
    ]) await expect(field, `${width}px 상세 필드는 모두 보여야 합니다`).toBeVisible()
    await expect(page.getByLabel(amountLabel, { exact: true })).toHaveValue(formatInputWon(amount))
    await expect(memo, `${width}px에서 메모 draft를 보존해야 합니다`).toHaveValue(memoDraft)
    await expect(selectedButton, `${width}px에서 상세 종류 focus를 보존해야 합니다`).toBeFocused()
    await expectTypeGrid(page, typeGroup, width)
    if (width < 768) await expectAmountAndDateControlsStacked(page, amountLabel, width)
    else await expectAmountAndDateControlsAligned(page, amountLabel, width)
    await expectFormTargetsAtLeast44(page, typeGroup, [
      [page.getByLabel('자산 이름 (선택)', { exact: true }), '자산 이름'],
      [page.getByRole('radio', { name: '구성원 소유 : 구성원 한 명의 자산', exact: true }), '구성원 소유'],
      [page.getByRole('radio', { name: '공동 소유 : 가계부 구성원의 공동 자산', exact: true }), '공동 소유'],
      [page.getByRole('radiogroup', { name: '소유자' }).locator('label').first(), '소유자'],
      [page.getByLabel(amountLabel, { exact: true }), amountLabel],
      [page.getByLabel('잔액 기준일'), '잔액 기준일'],
      [memo, '메모'],
      [page.getByRole('link', { name: '취소' }), '취소'],
      [page.getByRole('button', { name: '변경 저장' }), '변경 저장'],
    ], width)
    expect(await hasPageOverflow(page), `${width}px 상세 화면에 가로 overflow가 없어야 합니다`).toBe(false)
  }
}

async function expectCardCreateAcrossBreakpoints(page: Page, typeGroup: Locator, cardButton: Locator) {
  const paymentDay = page.getByRole('spinbutton', { name: '결제일', exact: true })
  const openedOn = page.getByLabel('잔액 기준일', { exact: true })
  const openedOnDraft = await openedOn.inputValue()
  await paymentDay.focus()
  for (const width of [320, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 820 : 900 })
    await expectQuickCreateFields(page, '기준일 잔액')
    await expect(page.getByLabel('기준일 잔액')).toHaveValue('-180,000')
    await expect(openedOn).toHaveValue(openedOnDraft)
    await expect(page.getByLabel('정산일')).toHaveValue('15')
    await expect(paymentDay).toHaveValue('25')
    await expect(page.getByLabel('결제 월')).toHaveValue('1')
    await expect(paymentDay, `${width}px에서 카드 draft focus를 보존해야 합니다`).toBeFocused()
    await expect(cardButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('switch', { name: /^결제일에 자동 정산/ })).toHaveCount(0)
    await expectTypeGrid(page, typeGroup, width)
    if (width < 768) await expectAmountAndDateControlsStacked(page, '기준일 잔액', width)
    else await expectAmountAndDateControlsAligned(page, '기준일 잔액', width)
    await expectCardScheduleLayout(page, width)
    await expectFormTargetsAtLeast44(page, typeGroup, [
      [page.getByLabel('기준일 잔액'), '기준일 잔액'],
      [openedOn, '잔액 기준일'],
      [page.getByLabel('정산일'), '정산일'],
      [paymentDay, '결제일'],
      [page.getByLabel('결제 월'), '결제 월'],
      [page.getByLabel('결제 계좌', { exact: true }), '결제 계좌'],
      [page.getByRole('link', { name: '취소' }), '취소'],
      [page.getByRole('button', { name: '자산 등록', exact: true }), '자산 등록'],
    ], width)
    expect(await hasPageOverflow(page), `${width}px 카드 등록 화면에 가로 overflow가 없어야 합니다`).toBe(false)
  }
}

async function expectConditionalCreateAcrossBreakpoints(
  page: Page,
  typeGroup: Locator,
  selectedButton: Locator,
  expectedValues: Array<[Locator, string, string]>,
  focusedField: Locator,
  saveButtonName: '자산 등록' | '변경 저장' = '자산 등록',
) {
  await focusedField.focus()
  for (const width of [320, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 820 : 900 })
    for (const [field, value, label] of expectedValues) {
      await expectFieldValue(field, value, `${width}px에서 ${label} draft를 보존해야 합니다`)
    }
    await expect(focusedField, `${width}px에서 조건부 필드 focus를 보존해야 합니다`).toBeFocused()
    await expect(selectedButton, `${width}px에서 자산 종류 선택을 보존해야 합니다`).toHaveAttribute('aria-pressed', 'true')
    await expectTypeGrid(page, typeGroup, width)
    if (width < 768) await expectAmountAndDateControlsStacked(page, '기준일 잔액', width)
    else await expectAmountAndDateControlsAligned(page, '기준일 잔액', width)
    await expectFormTargetsAtLeast44(page, typeGroup, [
      ...expectedValues.map(([field, , label]): [Locator, string] => [field, label]),
      [page.getByRole('link', { name: '취소' }), '취소'],
      [page.getByRole('button', { name: saveButtonName, exact: true }), saveButtonName],
    ], width)
    expect(await hasPageOverflow(page), `${width}px 조건부 자산 화면에 가로 overflow가 없어야 합니다`).toBe(false)
  }
}

async function expectFieldValue(field: Locator, value: string, message: string) {
  if (await field.getAttribute('data-value') !== null) {
    await expect(field, message).toHaveAttribute('data-value', value)
    return
  }
  await expect(field, message).toHaveValue(value)
}

async function expectCardDetailAcrossBreakpoints(page: Page) {
  const longName = '함께 오래 쓰는 신혼 생활비 신용카드'.repeat(3).slice(0, 100)
  const name = page.getByLabel('자산 이름 (선택)', { exact: true })
  await name.fill(longName)
  await name.focus()
  for (const width of [320, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 820 : 900 })
    await expect(name).toHaveValue(longName)
    await expect(name, `${width}px에서 상세 이름 focus를 보존해야 합니다`).toBeFocused()
    await expect(page.getByRole('switch', { name: /^결제일에 자동 정산/ })).toBeVisible()
    for (const [target, label] of [
      [page.getByLabel('정산일'), '정산일'],
      [page.getByRole('spinbutton', { name: '결제일', exact: true }), '결제일'],
      [page.getByLabel('결제 월'), '결제 월'],
      [page.getByLabel('결제 계좌', { exact: true }), '결제 계좌'],
      [page.getByRole('switch', { name: /^결제일에 자동 정산/ }), '자동 정산'],
    ] as const) await expectHitTargetAtLeast44(target, `${width}px ${label}`)
    expect(await hasPageOverflow(page), `${width}px 카드 상세 화면에 가로 overflow가 없어야 합니다`).toBe(false)
  }
}

async function expectFormTargetsAtLeast44(
  page: Page,
  typeGroup: Locator,
  targets: Array<[Locator, string]>,
  width: number,
) {
  const typeButtons = await typeGroup.getByRole('button').all()
  typeButtons.forEach((button, index) => targets.push([button, `자산 종류 ${index + 1}`]))
  for (const [target, label] of targets) await expectHitTargetAtLeast44(target, `${width}px ${label}`)
}

async function expectHitTargetAtLeast44(locator: Locator, label: string) {
  await expect(locator, `${label} 조작 목표가 보여야 합니다`).toBeVisible()
  const box = await locator.evaluate((element) => {
    const effectiveTarget = element.matches('[role="radio"], [role="switch"], input[type="radio"], input[type="checkbox"]')
      ? element.closest('label') ?? element
      : element
    const rect = effectiveTarget.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(box.width, `${label} 조작 목표 너비는 44px 이상이어야 합니다`).toBeGreaterThanOrEqual(44)
  expect(box.height, `${label} 조작 목표 높이는 44px 이상이어야 합니다`).toBeGreaterThanOrEqual(44)
}

async function expectAmountAndDateControlsAligned(page: Page, amountLabel: string, width: number) {
  const [amount, date] = await Promise.all([
    page.getByLabel(amountLabel, { exact: true }),
    page.getByLabel('잔액 기준일', { exact: true }),
  ].map((field) => field.evaluate((element) => {
    const input = element.getBoundingClientRect()
    const wrapper = element.closest('[data-slot="field"], [data-slot="money-field"]')?.getBoundingClientRect()
    const label = (element as HTMLInputElement).labels?.[0]?.getBoundingClientRect()
    if (!wrapper || !label) throw new Error('접근 가능한 label 또는 Field wrapper를 찾지 못했습니다.')
    return { inputTop: input.top, inputHeight: input.height, labelTop: label.top, wrapperTop: wrapper.top, wrapperWidth: wrapper.width }
  })))
  expect(Math.abs(amount.wrapperTop - date.wrapperTop), `${width}px 금액과 잔액 기준일 wrapper는 같은 행에서 시작해야 합니다`).toBeLessThanOrEqual(1)
  expect(amount.wrapperWidth, `${width}px에서 금액 입력은 날짜보다 넓어야 합니다`).toBeGreaterThan(date.wrapperWidth)
  expect(Math.abs(amount.labelTop - date.labelTop), `${width}px 금액과 잔액 기준일 label은 같은 높이여야 합니다`).toBeLessThanOrEqual(1)
  expect(Math.abs(amount.inputTop - date.inputTop), `${width}px 금액과 잔액 기준일 input은 정렬되어야 합니다`).toBeLessThanOrEqual(1)
  expect(amount.inputHeight, `${width}px 금액 입력은 잔액 기준일보다 강조되어야 합니다`).toBeGreaterThan(date.inputHeight)
}

async function expectCardScheduleLayout(page: Page, width: number) {
  const controls = await Promise.all([
    page.getByLabel('정산일', { exact: true }),
    page.getByLabel('결제 월', { exact: true }),
    page.getByRole('spinbutton', { name: '결제일', exact: true }),
  ].map((field) => field.evaluate((element) => {
    const wrapper = element.closest('[data-slot="field"]')?.getBoundingClientRect()
    if (!wrapper) throw new Error('카드 일정 Field wrapper를 찾지 못했습니다.')
    return { top: wrapper.top, bottom: wrapper.bottom }
  })))
  if (width < 768) {
    expect(controls[1].top, `${width}px 결제 월은 정산일 아래에 있어야 합니다`).toBeGreaterThanOrEqual(controls[0].bottom - 1)
    expect(controls[2].top, `${width}px 결제일은 결제 월 아래에 있어야 합니다`).toBeGreaterThanOrEqual(controls[1].bottom - 1)
    return
  }
  expect(Math.abs(controls[0].top - controls[1].top), `${width}px 정산일과 결제 일정은 한 행에서 시작해야 합니다`).toBeLessThanOrEqual(1)
  expect(Math.abs(controls[1].top - controls[2].top), `${width}px 결제 월과 결제일은 함께 읽혀야 합니다`).toBeLessThanOrEqual(1)
}

async function expectAmountAndDateControlsStacked(page: Page, amountLabel: string, width: number) {
  const [amount, date] = await Promise.all([
    page.getByLabel(amountLabel, { exact: true }),
    page.getByLabel('잔액 기준일', { exact: true }),
  ].map((field) => field.evaluate((element) => {
    const wrapper = element.closest('[data-slot="field"], [data-slot="money-field"]')?.getBoundingClientRect()
    if (!wrapper) throw new Error('금액 또는 잔액 기준일 Field wrapper를 찾지 못했습니다.')
    return { top: wrapper.top, bottom: wrapper.bottom }
  })))
  expect(date.top, `${width}px에서는 잔액 기준일이 금액 아래에 적층되어야 합니다`).toBeGreaterThanOrEqual(amount.bottom - 1)
}

async function openNewAssetForm(page: Page) {
  await page.getByRole('link', { name: '자산 목록' }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '자산 추가' }).click()
  await expect(page.getByRole('heading', { name: '자산 등록', exact: true })).toBeVisible()
}

test('일반 자산 기준일 잔액은 빈 값과 직접 입력한 0을 모두 0원으로 등록한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `자산 0원 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()

  const amount = page.getByLabel('기준일 잔액', { exact: true })
  await expect(amount).toHaveValue('')
  await expect(amount).toHaveAttribute('placeholder', '0')

  const assetPostPayloads: Array<{ openingBalanceWon?: number }> = []
  page.on('request', (assetRequest) => {
    const url = new URL(assetRequest.url())
    if (assetRequest.method() === 'POST' && url.pathname === '/api/assets') {
      assetPostPayloads.push(assetRequest.postDataJSON() as { openingBalanceWon?: number })
    }
  })
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('빈 기준일 잔액 자산')
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  expect(assetPostPayloads).toHaveLength(1)
  expect(assetPostPayloads[0]?.openingBalanceWon, '빈 기준일 잔액은 payload에서 0원이어야 합니다').toBe(0)
  await expect(balanceAssetRow(page, '빈 기준일 잔액 자산', '0원')).toBeVisible()

  await page.getByRole('link', { name: '자산 추가' }).click()
  const explicitZeroAmount = page.getByLabel('기준일 잔액', { exact: true })
  await expect(explicitZeroAmount).toHaveValue('')
  await explicitZeroAmount.fill('0')
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('명시적 0원 자산')
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  expect(assetPostPayloads).toHaveLength(2)
  expect(assetPostPayloads[1]?.openingBalanceWon, '직접 입력한 0도 payload에서 0원이어야 합니다').toBe(0)
  await expect(balanceAssetRow(page, '명시적 0원 자산', '0원')).toBeVisible()
})

async function selectAssetTypeWithKeyboard(page: Page, button: Locator, label: string) {
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button, `${label} 유형 전환 뒤 focus를 유지해야 합니다`).toBeFocused()
  await expect(button, `${label} 유형 전환 뒤 선택 상태를 보여야 합니다`).toHaveAttribute('aria-pressed', 'true')
}

test('새 가계부의 기본 자산과 이름을 포함한 빠른 자산 등록이 목록에서 즉시 상세로 이어진다', async ({ page, request }) => {
  await registerAndLogin(page, request, `빠른 자산 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  for (const defaultAssetName of ['현금', '계좌']) {
    await expect(balanceAssetRow(page, defaultAssetName, '0원'), `${defaultAssetName} 기본 자산이 0원으로 보여야 합니다`).toBeVisible()
  }
  for (const defaultCardName of ['신용카드', '체크카드']) {
    const row = cardAssetRow(page, defaultCardName)
    await expect(row, `${defaultCardName} 기본 자산이 보여야 합니다`).toBeVisible()
    await expectCardPaymentAmounts(row)
  }
  await expect(page.getByRole('listitem')).toHaveCount(4)
  await page.getByRole('link', { name: '자산 추가' }).click()

  const typeGroup = page.getByRole('group', { name: '자산 종류' })
  const typeButtons = typeGroup.getByRole('button')
  await expect(typeButtons).toHaveCount(9)
  expect(await typeButtons.evaluateAll((buttons) => buttons.every((button) => button.tagName === 'BUTTON'))).toBe(true)
  await expect(typeGroup.getByRole('button', { name: '적금', exact: true })).toBeVisible()
  await expect(typeGroup.getByRole('button', { name: '저축', exact: true })).toHaveCount(0)
  await expect(typeGroup.getByRole('button', { name: '마이너스 통장', exact: true })).toHaveCount(0)
  const cashButton = typeGroup.getByRole('button', { name: '현금', exact: true })
  const otherButton = typeGroup.getByRole('button', { name: '기타', exact: true })
  const loanButton = typeGroup.getByRole('button', { name: '대출', exact: true })
  await expect(cashButton, '첫 focus는 기본 선택된 종류여야 합니다').toBeFocused()
  await expect(cashButton).toHaveAttribute('aria-pressed', 'true')
  await expectQuickCreateFields(page, '기준일 잔액')
  await expectInputBodyOpensDatePicker(page, page.getByLabel('잔액 기준일', { exact: true }), '신규 자산 잔액 기준일')

  await otherButton.click()
  await loanButton.click()
  await expect(page.getByLabel('기준일 잔액', { exact: true })).toHaveCount(0)
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('신혼집 대출')
  await page.getByLabel('기준일 대출 잔액', { exact: true }).fill('-25000000')
  await expectQuickCreateAcrossBreakpoints(page, typeGroup, loanButton, '기준일 대출 잔액', '-25000000')

  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  const row = balanceAssetRow(page, '신혼집 대출', '-25,000,000원')
  await expect(row).toBeVisible()
  await row.getByRole('link').click()

  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('신혼집 대출')
  await expect(page.getByRole('radio', { name: '구성원 소유 : 구성원 한 명의 자산', exact: true })).toBeChecked()
  const ownerGroup = page.getByRole('radiogroup', { name: '소유자' })
  await expect(ownerGroup.getByRole('radio').first()).toBeChecked()
  await expect(ownerGroup.locator('[data-member-avatar]')).toHaveAttribute('data-member-initial', '빠')
  await expect(page.getByLabel('잔액 기준일')).toHaveValue(todayInSeoul())
  await expect(page.getByLabel('메모 (선택)')).toHaveValue('')
  const detailTypes = page.getByRole('group', { name: '자산 종류' })
  const detailLoan = detailTypes.getByRole('button', { name: '대출', exact: true })
  await expectDetailAcrossBreakpoints(page, detailTypes, detailLoan, '기준일 대출 잔액', '-25000000', '상세에서 보완한 대출 메모')
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('신혼집 공동 대출')
  await page.getByRole('button', { name: '변경 저장' }).click()
  await expect(page.getByRole('status')).toContainText('자산 정보를 저장했어요')
})

test('자산 이름을 직접 저장하거나 비워 두면 고정 종류 이름에 순번을 붙인다', async ({ page, request }) => {
  await registerAndLogin(page, request, `자산 기본값 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()

  await openQuickAssetDetail(page, { typeName: '계좌', name: '우리 비상금', amount: '1250000', expectedName: '우리 비상금', expectedAmount: '1,250,000원' })
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('우리 비상금')

  await openNewAssetForm(page)
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('')
  await openQuickAssetDetail(page, { typeName: '계좌', amount: '250000', expectedName: '계좌 2', expectedAmount: '250,000원' })
  const name = page.getByLabel('자산 이름 (선택)', { exact: true })
  await expect(name).toHaveValue('계좌 2')
  await name.fill('투자 준비금')
  await page.getByRole('group', { name: '자산 종류' }).getByRole('button', { name: '투자', exact: true }).click()
  await expect(name, '상세에서 종류를 바꿔도 직접 입력한 이름을 보존해야 합니다').toHaveValue('투자 준비금')
  await page.getByRole('button', { name: '변경 저장' }).click()
  await expect(page.getByRole('status')).toContainText('자산 정보를 저장했어요')

  await openNewAssetForm(page)
  await openQuickAssetDetail(page, { typeName: '기타', amount: '300000', expectedName: '기타', expectedAmount: '300,000원' })
  await expect(page.getByRole('textbox', { name: /종류/ }), '상세에서도 사용자 정의 종류 입력을 제공하면 안 됩니다').toHaveCount(0)
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('기타')
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('여행 통장')
  await page.getByRole('button', { name: '변경 저장' }).click()
  await expect(page.getByRole('status')).toContainText('자산 정보를 저장했어요')
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('여행 통장')
})

test('체크카드는 결제 계좌를 필수로 저장하고 적금 자동이체는 선택해서 설정한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `자동이체 자산 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()
  const paymentAssetName = '자동이체 전용 계좌'
  await openQuickAssetDetail(page, { typeName: '계좌', name: paymentAssetName, amount: '1250000', expectedName: paymentAssetName, expectedAmount: '1,250,000원' })

  await openNewAssetForm(page)
  let typeGroup = page.getByRole('group', { name: '자산 종류' })
  let debitCardButton = typeGroup.getByRole('button', { name: '체크카드', exact: true })
  let savingsButton = typeGroup.getByRole('button', { name: '적금', exact: true })
  await debitCardButton.click()
  const debitAmount = page.getByLabel('기준일 잔액', { exact: true })
  const debitOpenedOn = page.getByLabel('잔액 기준일', { exact: true })
  const settlementAccount = page.getByLabel('결제 계좌', { exact: true })
  await debitAmount.fill('180000')
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('생활 체크카드')
  await debitOpenedOn.fill('2026-06-20')
  await expect(settlementAccount).toBeVisible()

  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(settlementAccount, '체크카드 결제 계좌는 필수여야 합니다').toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL(/\/assets\/new/)
  await expect(debitAmount).toHaveValue('180,000')
  await expect(debitOpenedOn).toHaveValue('2026-06-20')
  await selectAsset(page, '결제 계좌', paymentAssetName)
  const settlementAccountId = await settlementAccount.getAttribute('data-value') ?? ''

  await selectAssetTypeWithKeyboard(page, savingsButton, '적금')
  await expect(debitAmount).toHaveValue('180,000')
  await expect(debitOpenedOn).toHaveValue('2026-06-20')
  await selectAssetTypeWithKeyboard(page, debitCardButton, '체크카드')
  await expect(settlementAccount).toHaveAttribute('data-value', settlementAccountId)
  await expectConditionalCreateAcrossBreakpoints(page, typeGroup, debitCardButton, [
    [debitAmount, '180,000', '기준일 잔액'],
    [debitOpenedOn, '2026-06-20', '잔액 기준일'],
    [settlementAccount, settlementAccountId, '결제 계좌'],
  ], settlementAccount)

  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  const debitCardRow = cardAssetRow(page, '생활 체크카드')
  await expect(debitCardRow).toBeVisible()
  await expectCardPaymentAmounts(debitCardRow)
  await debitCardRow.getByRole('link').click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expect(page.getByLabel('잔액 기준일', { exact: true })).toHaveValue('2026-06-20')
  await expect(page.getByLabel('결제 계좌', { exact: true })).toHaveAttribute('data-value', settlementAccountId)
  await expect(page.getByLabel('결제 계좌', { exact: true })).toContainText(paymentAssetName)

  await openNewAssetForm(page)
  typeGroup = page.getByRole('group', { name: '자산 종류' })
  debitCardButton = typeGroup.getByRole('button', { name: '체크카드', exact: true })
  savingsButton = typeGroup.getByRole('button', { name: '적금', exact: true })
  await savingsButton.click()
  const savingsAmount = page.getByLabel('기준일 잔액', { exact: true })
  const savingsOpenedOn = page.getByLabel('잔액 기준일', { exact: true })
  const autoTransferSwitch = page.getByRole('switch', { name: '자동이체 설정', exact: true })
  await expect(autoTransferSwitch).not.toBeChecked()
  await expect(page.getByLabel('자동이체 계좌', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: '자동이체일', exact: true })).toHaveCount(0)
  await savingsAmount.fill('430000')
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('공동 적금')
  await savingsOpenedOn.fill('2026-07-03')

  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  const savingsRow = balanceAssetRow(page, '공동 적금', '430,000원')
  await expect(savingsRow).toBeVisible()
  await savingsRow.getByRole('link').click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expect(page.getByLabel('잔액 기준일', { exact: true })).toHaveValue('2026-07-03')
  const detailAutoTransferSwitch = page.getByRole('switch', { name: '자동이체 설정', exact: true })
  await expect(detailAutoTransferSwitch).not.toBeChecked()

  await detailAutoTransferSwitch.click()
  const autoTransferAccount = page.getByLabel('자동이체 계좌', { exact: true })
  const autoTransferDay = page.getByRole('spinbutton', { name: '자동이체일', exact: true })
  await expect(autoTransferDay).toHaveAttribute('min', '1')
  await expect(autoTransferDay).toHaveAttribute('max', '31')
  await page.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(autoTransferAccount, '자동이체를 켜면 계좌가 필수여야 합니다').toHaveAttribute('aria-invalid', 'true')
  await expect(autoTransferDay, '자동이체를 켜면 이체일이 필수여야 합니다').toHaveAttribute('aria-invalid', 'true')
  await selectAsset(page, '자동이체 계좌', paymentAssetName)
  const autoTransferAccountId = await autoTransferAccount.getAttribute('data-value') ?? ''
  await autoTransferDay.fill('32')
  await page.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(autoTransferDay, '적금 자동이체일은 31일을 넘을 수 없습니다').toHaveAttribute('aria-invalid', 'true')
  await expect(autoTransferDay).toHaveValue('32')
  await autoTransferDay.fill('27')

  await expectConditionalCreateAcrossBreakpoints(page, page.getByRole('group', { name: '자산 종류' }), page.getByRole('group', { name: '자산 종류' }).getByRole('button', { name: '적금', exact: true }), [
    [page.getByLabel('기준일 잔액', { exact: true }), '430,000', '기준일 잔액'],
    [page.getByLabel('잔액 기준일', { exact: true }), '2026-07-03', '잔액 기준일'],
    [autoTransferAccount, autoTransferAccountId, '자동이체 계좌'],
    [autoTransferDay, '27', '자동이체일'],
  ], autoTransferDay, '변경 저장')

  await page.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('자산 정보를 저장했어요.')
  await expect(detailAutoTransferSwitch).toBeChecked()
  await expect(page.getByLabel('자동이체 계좌', { exact: true })).toHaveAttribute('data-value', autoTransferAccountId)
  await expect(page.getByLabel('자동이체 계좌', { exact: true })).toContainText(paymentAssetName)
  await expect(page.getByRole('spinbutton', { name: '자동이체일', exact: true })).toHaveValue('27')
})

test('신용카드 빠른 등록은 필수 정산 정보만 받고 자동 정산은 상세에서 설정한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `신용카드 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()
  const settlementAssetName = '카드 결제 계좌'
  await openQuickAssetDetail(page, { typeName: '계좌', name: settlementAssetName, amount: '1250000', expectedName: settlementAssetName, expectedAmount: '1,250,000원' })

  await openNewAssetForm(page)
  const typeGroup = page.getByRole('group', { name: '자산 종류' })
  const cardButton = typeGroup.getByRole('button', { name: '신용카드', exact: true })
  await cardButton.click()
  const cardSettings = page.getByRole('group', { name: '신용카드 설정' })
  await expectFlatStructure(cardSettings, '신용카드 설정 fieldset')
  await expectQuickCreateFields(page, '기준일 잔액')
  await expect(page.getByRole('switch', { name: /^결제일에 자동 정산/ })).toHaveCount(0)
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('생활비 신용카드')
  await page.getByLabel('기준일 잔액').fill('-180000')
  await page.getByLabel('정산일').fill('15')
  await page.getByRole('spinbutton', { name: '결제일', exact: true }).fill('25')
  await page.getByLabel('결제 월').selectOption('1')
  await expectCardCreateAcrossBreakpoints(page, typeGroup, cardButton)

  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '입력하지 않았거나 확인이 필요한 항목이 있어요.' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '결제 계좌를 선택해 주세요.' })).toBeVisible()
  await expect(page).toHaveURL(/\/assets\/new/)
  await expect(page.getByLabel('기준일 잔액')).toHaveValue('-180,000')
  await expect(page.getByLabel('정산일')).toHaveValue('15')
  await expect(page.getByRole('spinbutton', { name: '결제일', exact: true })).toHaveValue('25')
  await expect(page.getByLabel('결제 월')).toHaveValue('1')

  await selectAsset(page, '결제 계좌', settlementAssetName)
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  const row = cardAssetRow(page, '생활비 신용카드')
  await expect(row).toBeVisible()
  await expectCardPaymentAmounts(row, { currentMonth: '0원', nextMonth: '180,000원' })
  await row.getByRole('link').click()

  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('생활비 신용카드')
  await expect(page.getByLabel('결제 계좌', { exact: true })).toHaveAttribute('data-value', /.+/)
  const autoSettlement = page.getByRole('switch', { name: /^결제일에 자동 정산/ })
  await expect(autoSettlement).not.toBeChecked()
  await expectFlatStructure(page.getByRole('group', { name: '신용카드 설정' }), '상세 신용카드 설정 fieldset')
  await expectCardDetailAcrossBreakpoints(page)
  await autoSettlement.click()
  await page.getByRole('button', { name: '변경 저장' }).click()
  await expect(page.getByRole('status')).toContainText('자산 정보를 저장했어요')
  await expect(autoSettlement).toBeChecked()
})

async function hasPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

function todayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function formatInputWon(value: string) {
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  return `${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}
