import { expect, test, type Locator, type Page } from '@playwright/test'
import { submitQuickAsset } from './support/assets'
import { registerAndLogin } from './support/auth'
import { selectTransactionCategory } from './support/transactions'

test('공동 분류를 추가·수정하고 사용 중 삭제하면 거래를 같은 방향 기타로 이동한다', async ({ page, request, context }) => {
  const suffix = `${test.info().workerIndex}-${Date.now().toString().slice(-6)}`
  const originalName = `QC 반려동물 ${suffix}`
  const renamedName = `QC 가족생활 ${suffix}`
  const fallbackName = '기타 지출'
  const amount = 13_579

  await registerAndLogin(page, request, `분류 관리자 ${suffix}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.goto('/assets/new')
  await submitQuickAsset(page, {
    typeName: '계좌',
    name: '분류 테스트 계좌',
    amount: '500000',
    expectedName: '분류 테스트 계좌',
    expectedAmount: '500,000원',
  })

  await page.goto('/settings')
  const categorySettingsLink = page.getByRole('link', { name: /^분류 설정/ })
  await expect(categorySettingsLink).toBeVisible()
  await categorySettingsLink.click()
  await expect(page.getByRole('heading', { name: '분류 설정', exact: true })).toBeVisible()
  const kindGroup = page.getByRole('group', { name: '분류 종류' })
  await expect(kindGroup.getByRole('button', { name: '지출 분류' })).toHaveAttribute('aria-pressed', 'true')
  const initialCategories = await readCategories(page, 'EXPENSE')
  for (const category of initialCategories) await expect(categoryButton(page, category.name)).toBeVisible()
  await expect(categoryButtons(page)).toHaveCount(initialCategories.length)
  await categoryButton(page, fallbackName).click()
  await expectSelectedCategoryControls(page, fallbackName, 0, false)

  const addName = page.getByRole('textbox', { name: '지출 분류 추가' })
  await addName.fill(originalName)
  await addName.focus()
  await context.setOffline(true)
  await expect(page.getByRole('status').filter({ hasText: '오프라인 상태예요' })).toBeVisible()
  await expect(page.getByRole('button', { name: '추가', exact: true })).toBeDisabled()
  await expectCategoryDraftAcrossWidths(page, addName, originalName, fallbackName)
  await context.setOffline(false)
  await expect(page.getByRole('status').filter({ hasText: '오프라인 상태예요' })).toHaveCount(0)

  await page.getByRole('button', { name: '추가', exact: true }).click()
  await expect(categoryButton(page, originalName)).toBeVisible()

  await categoryButton(page, originalName).click()
  await expectSelectedCategoryControls(page, originalName, 0, true)
  await page.getByRole('button', { name: `${originalName} 이름 수정` }).click()
  const renameInput = page.getByRole('textbox', { name: `${originalName} 이름 수정` })
  await renameInput.fill(renamedName)
  await renameInput.focus()
  await expectCategoryDraftAcrossWidths(page, renameInput, renamedName, originalName)
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(categoryButton(page, renamedName)).toBeVisible()
  await expect(categoryButton(page, originalName)).toHaveCount(0)

  await page.goto('/transactions/new')
  await page.getByLabel('금액').fill(String(amount))
  await selectTransactionCategory(page, renamedName)
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요.')
  await expect(transactionRow(page, renamedName)).toContainText(`-${amount.toLocaleString('ko-KR')}원`)

  await page.goto('/settings/categories?kind=EXPENSE')
  await categoryButton(page, renamedName).click()
  await expectSelectedCategoryControls(page, renamedName, 1, true)
  await page.getByRole('button', { name: `${renamedName} 삭제` }).click()

  const deleteHeading = page.getByRole('heading', { name: `‘${renamedName}’ 분류를 삭제할까요?` })
  await expect(deleteHeading).toBeVisible()
  await expect(page.getByText(`연결된 거래 1건은 ‘${fallbackName}’ 분류로 옮겨져요. 거래 자체는 삭제되지 않습니다.`, { exact: true })).toBeVisible()
  await expectTouchTarget(page.getByRole('button', { name: '분류 삭제', exact: true }), '분류 삭제')
  await page.getByRole('button', { name: '분류 삭제', exact: true }).click()

  await expect(page.getByRole('status')).toContainText(`‘${fallbackName}’ 분류로 1건을 옮기고 삭제했어요.`)
  await expect(categoryButton(page, renamedName)).toHaveCount(0)
  await expect(page.getByRole('button', { name: `${fallbackName} 삭제` })).toHaveCount(0)

  const month = todayInSeoul().slice(0, 7)
  await page.goto(`/?view=daily&month=${month}`)
  const remapped = transactionRow(page, fallbackName)
  await expect(remapped).toContainText(`-${amount.toLocaleString('ko-KR')}원`)
  await expect(remapped.getByRole('link', { name: `${fallbackName} 거래 수정` })).toBeVisible()
  expect(await hasPageOverflow(page)).toBe(false)
})

test('수입 분류를 추가해 선택 상세가 열려도 분류 버튼은 compact 높이를 유지한다', async ({ page, request }) => {
  const suffix = `${test.info().workerIndex}-${Date.now().toString().slice(-6)}`
  const categoryName = `보너스${Date.now().toString().slice(-5)}`

  await registerAndLogin(page, request, `수입 분류 관리자 ${suffix}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/settings/categories?kind=INCOME')

  await page.getByRole('textbox', { name: '수입 분류 추가' }).fill(categoryName)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await expect(page.getByRole('button', { name: categoryName, exact: true })).toHaveAttribute('aria-pressed', 'true')

  const buttonHeights = await page.getByRole('group', { name: '수입 분류 선택' }).getByRole('button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)))
  expect(Math.max(...buttonHeights), '선택 상세 패널 높이가 분류 버튼 행에 전파되면 안 됩니다').toBeLessThanOrEqual(56)
  for (const height of buttonHeights) expect(height, '모든 수입 분류 버튼은 최소 터치 높이를 유지해야 합니다').toBeGreaterThanOrEqual(44)
  expect(await hasPageOverflow(page)).toBe(false)
})

function categoryRegion(page: Page) {
  return page.getByRole('region', { name: '지출 분류', exact: true })
}

function categoryButtons(page: Page) {
  return categoryRegion(page).getByRole('button', { pressed: false }).or(categoryRegion(page).getByRole('button', { pressed: true }))
}

function categoryButton(page: Page, name: string) {
  return categoryRegion(page).getByRole('button', { name, exact: true })
}

function transactionRow(page: Page, label: string) {
  return page.getByRole('listitem').filter({ has: page.getByRole('link', { name: `${label} 거래 수정` }) })
}

async function expectCategoryDraftAcrossWidths(page: Page, input: Locator, value: string, selectedCategory: string) {
  const originalViewport = page.viewportSize()
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 760 : 900 })
    await expect(input).toHaveValue(value)
    await expect(input).toBeFocused()
    await expect(page.getByRole('group', { name: '분류 종류' }).getByRole('button', { name: '지출 분류' })).toHaveAttribute('aria-pressed', 'true')
    await expect(categoryButton(page, selectedCategory)).toHaveAttribute('aria-pressed', 'true')
    await expect(categoryRegion(page).getByRole('button', { pressed: true })).toHaveCount(1)
    expect(await hasPageOverflow(page)).toBe(false)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
  await expect(input).toHaveValue(value)
  await expect(input).toBeFocused()
  await expectTouchTarget(page.getByRole('button', { name: '추가', exact: true }), '분류 추가')
  await expectTouchTarget(page.getByRole('button', { name: '지출 분류' }), '지출 분류')
}

async function expectSelectedCategoryControls(page: Page, name: string, transactionCount: number, deletable: boolean) {
  await expect(categoryButton(page, name)).toHaveAttribute('aria-pressed', 'true')
  await expect(categoryRegion(page).getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(page.getByText(`연결된 거래 ${transactionCount}건`, { exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: / 이름 수정$/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: / 삭제$/ })).toHaveCount(deletable ? 1 : 0)
  if (!deletable) await expect(page.getByRole('button', { name: `${name} 삭제` })).toHaveCount(0)
}

async function readCategories(page: Page, kind: 'EXPENSE' | 'INCOME') {
  return page.evaluate(async (categoryKind) => {
    const response = await fetch(`/api/categories?kind=${categoryKind}`)
    if (!response.ok) throw new Error(`분류 조회 실패: ${response.status}`)
    return response.json() as Promise<Array<{ name: string }>>
  }, kind)
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

function todayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
