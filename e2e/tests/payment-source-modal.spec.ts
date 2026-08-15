import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { cardAssetRow, expectCardPaymentAmounts } from './support/assets'
import { openAssetPicker } from './support/asset-picker'
import { registerAndLogin } from './support/auth'

type PaymentSourceMask = {
  enabled: boolean
  hiddenReadCount: number
  rejectNextPost: boolean
  rejectedPostCount: number
}

type CreatedAsset = {
  assetId: string
  assetTypeName: string
  name: string
}

const LINKED_ASSET_SCENARIOS = [
  {
    typeName: '체크카드',
    triggerName: '체크카드 결제 계좌 만들기',
    selectName: '결제 계좌',
    parentName: 'QC 모달 체크카드',
    accountName: 'QC 체크카드 계좌',
  },
  {
    typeName: '적금',
    triggerName: '적금 자동이체 계좌 만들기',
    selectName: '자동이체 계좌',
    parentName: 'QC 모달 적금',
    accountName: 'QC 적금 계좌',
  },
] as const

const EXISTING_PAYMENT_SOURCE_SCENARIOS = [
  {
    typeName: '신용카드',
    triggerName: '신용카드 결제 계좌 만들기',
    selectName: '결제 계좌',
    accountName: 'QC 추가 신용카드 계좌',
  },
  {
    typeName: '체크카드',
    triggerName: '체크카드 결제 계좌 만들기',
    selectName: '결제 계좌',
    accountName: 'QC 추가 체크카드 계좌',
  },
  {
    typeName: '적금',
    triggerName: '적금 자동이체 계좌 만들기',
    selectName: '자동이체 계좌',
    accountName: 'QC 추가 적금 계좌',
  },
] as const

const CARD_OPENED_ON = currentMonthFirstDayInSeoul()

test.use({ serviceWorkers: 'block' })

test('신용카드에서 계좌를 바로 만들면 부모 draft를 보존하고 응답 자산을 자동 선택한다', async ({ page, request, context }) => {
  const paymentSources = await prepareAssetFormWithoutPaymentSources(page, request, '신용카드 계좌 모달')
  const parentForm = page.locator('main form')
  const typeGroup = parentForm.getByRole('group', { name: '자산 종류' })
  await typeGroup.getByRole('button', { name: '신용카드', exact: true }).click()

  const parentName = parentForm.getByLabel('자산 이름 (선택)', { exact: true })
  const parentAmount = parentForm.getByLabel('기준일 잔액', { exact: true })
  const parentOpenedOn = parentForm.getByLabel('잔액 기준일', { exact: true })
  await parentName.fill('QC 생활비 신용카드')
  await parentAmount.fill('-180000')
  await parentOpenedOn.fill(CARD_OPENED_ON)
  await parentForm.getByLabel('정산일').fill('15')
  await parentForm.getByRole('spinbutton', { name: '결제일', exact: true }).fill('25')
  await parentForm.getByLabel('결제 월').selectOption('1')

  const creditTrigger = parentForm.getByRole('button', { name: '신용카드 결제 계좌 만들기' })
  await expect(creditTrigger).toContainText('계좌 추가')
  await typeGroup.getByRole('button', { name: '체크카드', exact: true }).click()
  await expect(parentForm.getByRole('button', { name: '체크카드 결제 계좌 만들기' })).toBeVisible()
  await typeGroup.getByRole('button', { name: '적금', exact: true }).click()
  await parentForm.getByRole('switch', { name: '자동이체 설정', exact: true }).click()
  await expect(parentForm.getByRole('button', { name: '적금 자동이체 계좌 만들기' })).toBeVisible()
  await typeGroup.getByRole('button', { name: '신용카드', exact: true }).click()
  await expect(parentName).toHaveValue('QC 생활비 신용카드')
  await expect(parentAmount).toHaveValue('-180,000')
  await expect(parentOpenedOn).toHaveValue(CARD_OPENED_ON)
  expect(paymentSources.hiddenReadCount, 'GET /api/assets에서 결제 계좌 후보를 숨겨야 합니다').toBeGreaterThan(0)

  await expectModalDismissal(page, context, creditTrigger, parentForm)

  await creditTrigger.click()
  const dialog = page.getByRole('dialog', { name: '계좌 바로 만들기' })
  const accountName = dialog.getByLabel('자산 이름 (선택)', { exact: true })
  const accountAmount = dialog.getByLabel('기준일 잔액', { exact: true })
  const accountOpenedOn = dialog.getByLabel('잔액 기준일', { exact: true })
  await accountName.fill('QC 카드 결제 계좌')
  await accountAmount.fill('350000')
  await accountOpenedOn.fill(CARD_OPENED_ON)
  await accountName.focus()

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await expectPaymentSourceDialogLayout(page, dialog, viewport)
    await expect(accountName, `${viewport.width}px에서 모달 이름 draft를 보존해야 합니다`).toHaveValue('QC 카드 결제 계좌')
    await expect(accountAmount, `${viewport.width}px에서 모달 금액 draft를 보존해야 합니다`).toHaveValue('350,000')
    await expect(accountOpenedOn, `${viewport.width}px에서 모달 잔액 기준일 draft를 보존해야 합니다`).toHaveValue(CARD_OPENED_ON)
    await expect(accountName, `${viewport.width}px resize 뒤 모달 focus를 보존해야 합니다`).toBeFocused()
    await expectParentCardDraft(parentForm)
  }

  paymentSources.rejectNextPost = true
  const rejectedResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' && url.pathname === '/api/assets' && response.status() === 422
  })
  await dialog.getByRole('button', { name: '계좌 등록', exact: true }).click()
  await rejectedResponsePromise
  expect(paymentSources.rejectedPostCount, '첫 계좌 생성 POST만 테스트 오류로 거부해야 합니다').toBe(1)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText('계좌 등록 테스트 오류')
  await expect(accountName).toHaveValue('QC 카드 결제 계좌')
  await expect(accountAmount).toHaveValue('350,000')
  await expect(accountOpenedOn).toHaveValue(CARD_OPENED_ON)
  await expectParentCardDraft(parentForm)

  paymentSources.enabled = false
  const created = await submitInlineAccount(page, dialog, 'QC 카드 결제 계좌', 350000)
  expect(created.assetTypeName).toBe('계좌')
  expect(created.name).toBe('QC 카드 결제 계좌')

  const settlementAsset = parentForm.getByLabel('결제 계좌', { exact: true })
  await expect(dialog).toBeHidden()
  await expect(settlementAsset).toHaveAttribute('data-value', created.assetId)
  await expect(settlementAsset).toContainText('QC 카드 결제 계좌')
  await expect(settlementAsset).toBeFocused()
  await expectParentCardDraft(parentForm)
  expect(context.pages(), '계좌 생성은 새 탭을 열지 않아야 합니다').toHaveLength(1)

  await parentForm.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  const cardRow = cardAssetRow(page, 'QC 생활비 신용카드')
  await expect(cardRow).toBeVisible()
  await expectCardPaymentAmounts(cardRow, { nearest: '180,000원' })
})

for (const scenario of LINKED_ASSET_SCENARIOS) {
  test(`${scenario.typeName} 계좌 바로 만들기도 응답 자산을 부모 선택에 연결한다`, async ({ page, request, context }) => {
    const paymentSources = await prepareAssetFormWithoutPaymentSources(page, request, `${scenario.typeName} 계좌 모달`)
    const parentForm = page.locator('main form')
    await parentForm.getByRole('group', { name: '자산 종류' })
      .getByRole('button', { name: scenario.typeName, exact: true })
      .click()

    const parentName = parentForm.getByLabel('자산 이름 (선택)', { exact: true })
    const parentAmount = parentForm.getByLabel('기준일 잔액', { exact: true })
    const parentOpenedOn = parentForm.getByLabel('잔액 기준일', { exact: true })
    await parentName.fill(scenario.parentName)
    await parentAmount.fill('270000')
    await parentOpenedOn.fill('2026-07-08')
    if (scenario.typeName === '적금') {
      await parentForm.getByRole('switch', { name: '자동이체 설정', exact: true }).click()
      await parentForm.getByRole('spinbutton', { name: '자동이체일', exact: true }).fill('27')
    }

    const trigger = parentForm.getByRole('button', { name: scenario.triggerName })
    await expect(trigger).toContainText('계좌 추가')
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '계좌 바로 만들기' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('자산 이름 (선택)', { exact: true }).fill(scenario.accountName)
    await dialog.getByLabel('기준일 잔액', { exact: true }).fill('410000')

    paymentSources.enabled = false
    const created = await submitInlineAccount(page, dialog, scenario.accountName, 410000)
    const linkedAsset = parentForm.getByLabel(scenario.selectName, { exact: true })
    await expect(linkedAsset).toHaveAttribute('data-value', created.assetId)
    await expect(linkedAsset).toContainText(scenario.accountName)
    await expect(linkedAsset).toBeFocused()
    await expect(parentName).toHaveValue(scenario.parentName)
    await expect(parentAmount).toHaveValue('270,000')
    await expect(parentOpenedOn).toHaveValue('2026-07-08')
    if (scenario.typeName === '적금') {
      await expect(parentForm.getByRole('spinbutton', { name: '자동이체일', exact: true })).toHaveValue('27')
    }
    expect(context.pages(), '계좌 생성은 새 탭을 열지 않아야 합니다').toHaveLength(1)
  })
}

test('기본 계좌 후보가 있어도 카드와 적금에서 계좌를 추가하고 새 계좌를 자동 선택한다', async ({ page, request, context }) => {
  await registerAndLogin(page, request, `기존 계좌 추가 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.goto('/assets/new')
  const parentForm = page.locator('main form')
  const typeGroup = parentForm.getByRole('group', { name: '자산 종류' })

  for (const scenario of EXISTING_PAYMENT_SOURCE_SCENARIOS) {
    await typeGroup.getByRole('button', { name: scenario.typeName, exact: true }).click()
    if (scenario.typeName === '적금') {
      const autoTransferSwitch = parentForm.getByRole('switch', { name: '자동이체 설정', exact: true })
      if (!(await autoTransferSwitch.isChecked())) await autoTransferSwitch.click()
    }
    const linkedAsset = parentForm.getByLabel(scenario.selectName, { exact: true })
    const linkedPicker = await openAssetPicker(page, scenario.selectName, parentForm)
    expect(await linkedPicker.picker.locator('[data-asset-option]').count(), `${scenario.typeName}에는 기본 계좌 후보가 있어야 합니다`).toBeGreaterThan(0)
    await page.keyboard.press('Escape')

    const trigger = parentForm.getByRole('button', { name: scenario.triggerName })
    await expect(trigger, `${scenario.typeName}은 기존 후보가 있어도 계좌 추가 행동을 보여야 합니다`).toBeVisible()
    await expect(trigger).toContainText('계좌 추가')
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: '계좌 바로 만들기' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('자산 이름 (선택)', { exact: true }).fill(scenario.accountName)
    const openingBalance = dialog.getByLabel('기준일 잔액', { exact: true })
    await expect(openingBalance).toHaveValue('')
    if (scenario.typeName !== '신용카드') await openingBalance.fill('0')
    const created = await submitInlineAccount(page, dialog, scenario.accountName, 0)

    await expect(dialog).toBeHidden()
    await expect(linkedAsset).toHaveAttribute('data-value', created.assetId)
    await expect(linkedAsset).toContainText(scenario.accountName)
    await expect(linkedAsset).toBeFocused()
    expect(context.pages(), `${scenario.typeName} 계좌 추가는 새 탭을 열지 않아야 합니다`).toHaveLength(1)
  }
})

async function prepareAssetFormWithoutPaymentSources(
  page: Page,
  request: APIRequestContext,
  displayName: string,
) {
  await registerAndLogin(page, request, `${displayName} ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const state = await maskPaymentSourcesOnAssetReads(page)
  await page.goto('/assets/new')
  await expect(page.getByRole('heading', { name: '자산 등록', exact: true })).toBeVisible()
  return state
}

async function maskPaymentSourcesOnAssetReads(page: Page): Promise<PaymentSourceMask> {
  const state: PaymentSourceMask = {
    enabled: true,
    hiddenReadCount: 0,
    rejectNextPost: false,
    rejectedPostCount: 0,
  }
  await page.route('**/api/assets', async (route) => {
    if (route.request().method() === 'POST') {
      if (state.rejectNextPost) {
        state.rejectNextPost = false
        state.rejectedPostCount += 1
        await route.fulfill({
          status: 422,
          contentType: 'application/problem+json',
          json: {
            status: 422,
            errorCode: 'QC_PAYMENT_SOURCE_REJECTED',
            detail: '계좌 등록 테스트 오류',
          },
        })
        return
      }
    }
    if (route.request().method() !== 'GET' || !state.enabled) {
      await route.continue()
      return
    }

    const response = await route.fetch()
    if (!response.ok()) {
      await route.fulfill({ response })
      return
    }
    const assets = await response.json() as Array<Record<string, unknown>>
    state.hiddenReadCount += 1
    await route.fulfill({
      response,
      json: assets.map((asset) => ({ ...asset, paymentSourceCapable: false })),
    })
  })
  return state
}

async function expectModalDismissal(
  page: Page,
  context: BrowserContext,
  trigger: Locator,
  parentForm: Locator,
) {
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '계좌 바로 만들기' })
  const openingBalance = dialog.getByLabel('기준일 잔액', { exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '계좌 만들기 닫기' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '계좌 등록', exact: true })).toBeVisible()
  await expect(openingBalance, '최초 오픈 시 기준일 잔액은 사용자가 직접 입력하도록 비어 있어야 합니다').toHaveValue('')
  await expect(openingBalance).toHaveAttribute('placeholder', '0')
  expect(context.pages(), '모달을 열 때 새 탭이 생기면 안 됩니다').toHaveLength(1)
  await expectParentCardDraft(parentForm)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger, 'ESC로 닫으면 원래 계좌 만들기 버튼으로 focus가 돌아와야 합니다').toBeFocused()
  await expectParentCardDraft(parentForm)

  await trigger.click()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/assets\/new(?:\?|$)/)
  await expect(dialog).toBeHidden()
  await expect(trigger, '브라우저 뒤로가기로 닫으면 원래 계좌 만들기 버튼으로 focus가 돌아와야 합니다').toBeFocused()
  await expectParentCardDraft(parentForm)
}

async function expectPaymentSourceDialogLayout(
  page: Page,
  dialog: Locator,
  viewport: { width: number; height: number },
) {
  await expect(dialog).toBeVisible()
  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const contentRect = element.firstElementChild?.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      contentHeight: contentRect?.height ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
      verticalOverflow: element.scrollHeight > element.clientHeight + 1,
      radius: Math.max(
        parseFloat(style.borderTopLeftRadius),
        parseFloat(style.borderTopRightRadius),
        parseFloat(style.borderBottomRightRadius),
        parseFloat(style.borderBottomLeftRadius),
      ),
    }
  })
  const { width } = viewport
  const minimumVerticalMarginRatio = 0.01
  const topMarginRatio = layout.top / layout.viewportHeight
  const bottomMarginRatio = (layout.viewportHeight - layout.bottom) / layout.viewportHeight
  const heightRatio = layout.height / layout.viewportHeight
  const contentFillRatio = layout.contentHeight / layout.height
  expect(layout.left, `${width}px에서 모달 왼쪽이 viewport를 벗어나면 안 됩니다`).toBeGreaterThanOrEqual(-1)
  expect(layout.right, `${width}px에서 모달 오른쪽이 viewport를 벗어나면 안 됩니다`).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.top, `${width}px에서 모달 위쪽이 viewport를 벗어나면 안 됩니다`).toBeGreaterThanOrEqual(-1)
  expect(layout.bottom, `${width}px에서 모달 아래쪽이 viewport를 벗어나면 안 됩니다`).toBeLessThanOrEqual(layout.viewportHeight + 1)
  expect(heightRatio, `${width}x${viewport.height}에서 모달은 viewport 전체 높이를 채우면 안 됩니다`)
    .toBeLessThanOrEqual(1 - minimumVerticalMarginRatio * 2)
  expect(contentFillRatio, `${width}x${viewport.height}에서 모달 높이는 실제 내용에 맞아야 합니다`).toBeGreaterThanOrEqual(0.9)
  expect(topMarginRatio, `${width}x${viewport.height}에서 모달 위쪽 여백이 유지되어야 합니다`).toBeGreaterThanOrEqual(minimumVerticalMarginRatio)
  expect(bottomMarginRatio, `${width}x${viewport.height}에서 모달 아래쪽 여백이 유지되어야 합니다`).toBeGreaterThanOrEqual(minimumVerticalMarginRatio)
  expect(layout.horizontalOverflow, `${width}px에서 모달 내부가 가로로 넘치면 안 됩니다`).toBe(false)
  expect(layout.verticalOverflow, `${width}x${viewport.height}에서 충분한 높이의 모달 내부가 세로로 넘치면 안 됩니다`).toBe(false)
  expect(layout.radius, 'overlay 모달의 radius는 8px 이하여야 합니다').toBeLessThanOrEqual(8)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}px에서 페이지 가로 overflow가 없어야 합니다`).toBe(false)

  const [amountField, dateField] = await Promise.all([
    dialog.getByLabel('기준일 잔액', { exact: true }),
    dialog.getByLabel('잔액 기준일', { exact: true }),
  ].map((field) => field.evaluate((element) => {
    const wrapper = element.closest('[data-slot="field"], [data-slot="money-field"]')?.getBoundingClientRect()
    if (!wrapper) throw new Error('계좌 등록 Field wrapper를 찾지 못했습니다.')
    return { top: wrapper.top, bottom: wrapper.bottom, width: wrapper.width }
  })))
  if (width < 768) {
    expect(dateField.top, `${width}px 모달 잔액 기준일은 기준일 잔액 아래에 있어야 합니다`).toBeGreaterThanOrEqual(amountField.bottom - 1)
  } else {
    expect(Math.abs(amountField.top - dateField.top), `${width}px 모달 기준일 잔액과 잔액 기준일은 같은 행이어야 합니다`).toBeLessThanOrEqual(1)
    expect(amountField.width, `${width}px 모달 기준일 잔액은 잔액 기준일보다 넓어야 합니다`).toBeGreaterThan(dateField.width)
  }

  for (const [target, label] of [
    [dialog.getByRole('button', { name: '계좌 만들기 닫기' }), '닫기'],
    [dialog.getByLabel('자산 이름 (선택)', { exact: true }), '자산 이름'],
    [dialog.getByLabel('기준일 잔액', { exact: true }), '기준일 잔액'],
    [dialog.getByLabel('잔액 기준일', { exact: true }), '잔액 기준일'],
    [dialog.getByRole('button', { name: '취소', exact: true }), '취소'],
    [dialog.getByRole('button', { name: '계좌 등록', exact: true }), '계좌 등록'],
  ] as const) await expectHitTargetAtLeast44(target, `${width}px 모달 ${label}`)
}

async function expectHitTargetAtLeast44(locator: Locator, label: string) {
  await expect(locator, `${label} 조작 목표가 보여야 합니다`).toBeVisible()
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(box.width, `${label} 조작 목표 너비는 44px 이상이어야 합니다`).toBeGreaterThanOrEqual(44)
  expect(box.height, `${label} 조작 목표 높이는 44px 이상이어야 합니다`).toBeGreaterThanOrEqual(44)
}

async function expectParentCardDraft(parentForm: Locator) {
  await expect(parentForm.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('QC 생활비 신용카드')
  await expect(parentForm.getByLabel('기준일 잔액', { exact: true })).toHaveValue('-180,000')
  await expect(parentForm.getByLabel('잔액 기준일', { exact: true })).toHaveValue(CARD_OPENED_ON)
  await expect(parentForm.getByLabel('정산일')).toHaveValue('15')
  // Base UI modal은 열린 동안 배경 form을 접근성 트리에서 숨기므로 DOM label 연결로 draft만 확인한다.
  await expect(parentForm.getByLabel('결제일', { exact: true })).toHaveValue('25')
  await expect(parentForm.getByLabel('결제 월')).toHaveValue('1')
}

async function submitInlineAccount(
  page: Page,
  dialog: Locator,
  expectedName: string,
  expectedOpeningBalanceWon: number,
): Promise<CreatedAsset> {
  const requestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return request.method() === 'POST' && url.pathname === '/api/assets'
  }, { timeout: 5_000 })
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' && url.pathname === '/api/assets'
  }, { timeout: 5_000 })
  await dialog.getByRole('button', { name: '계좌 등록', exact: true }).click()
  const [assetRequest, assetResponse] = await Promise.all([requestPromise, responsePromise])
  const payload = assetRequest.postDataJSON() as { name?: string; openingBalanceWon?: number }
  expect(payload.name).toBe(expectedName)
  expect(payload.openingBalanceWon).toBe(expectedOpeningBalanceWon)
  expect(assetResponse.ok(), '모달의 계좌 생성 POST는 실제 backend 응답을 사용해야 합니다').toBe(true)
  return assetResponse.json() as Promise<CreatedAsset>
}

function currentMonthFirstDayInSeoul() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) throw new Error('서울 현재 월을 계산하지 못했습니다.')
  return `${year}-${month}-01`
}
