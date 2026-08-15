import { expect, type Locator, type Page } from '@playwright/test'

type BalanceQuickAsset = {
  typeName: '현금' | '계좌' | '적금' | '투자' | '대출' | '보험' | '기타'
  name?: string
  amount: string
  expectedName: string
  expectedAmount?: string
}

export function assetRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) })
}

export function balanceAssetRow(page: Page, name: string, balance: string) {
  return assetRow(page, name).filter({ has: page.getByTitle(`현재 잔액 ${balance}`) })
}

export function cardAssetRow(page: Page, name: string) {
  return assetRow(page, name)
}

export async function expectCardPaymentAmounts(
  row: Locator,
  expected: { currentMonth: string; nextMonth: string } = { currentMonth: '0원', nextMonth: '0원' },
) {
  await expectCardPaymentAmount(row, '이번 달 결제 금액', expected.currentMonth)
  await expectCardPaymentAmount(row, '다음 달 결제 예정 금액', expected.nextMonth)
  await expect(row).not.toContainText('부채')
  await expect(row.getByTitle(/^현재 잔액 /)).toHaveCount(0)
}

export async function submitQuickAsset(page: Page, asset: BalanceQuickAsset): Promise<Locator> {
  await page.getByRole('group', { name: '자산 종류' })
    .getByRole('button', { name: asset.typeName, exact: true })
    .click()
  if (asset.name !== undefined) {
    await page.getByLabel('자산 이름 (선택)', { exact: true }).fill(asset.name)
  }
  await page.getByLabel(asset.typeName === '대출' ? '기준일 대출 잔액' : '기준일 잔액', { exact: true }).fill(asset.amount)
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()

  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  const row = asset.expectedAmount
    ? balanceAssetRow(page, asset.expectedName, asset.expectedAmount)
    : assetRow(page, asset.expectedName)
  await expect(row, '저장 직후 목록 cache에 생성한 자산 행이 보여야 합니다').toBeVisible()
  if (asset.expectedAmount) await expect(row.getByTitle(`현재 잔액 ${asset.expectedAmount}`)).toBeVisible()
  return row
}

export async function openQuickAssetDetail(page: Page, asset: BalanceQuickAsset) {
  const row = await submitQuickAsset(page, asset)
  await row.getByRole('link').click()
  await page.getByRole('link', { name: '자산 편집' }).click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
}

async function expectCardPaymentAmount(row: Locator, label: string, amount: string) {
  await expect(row.getByTitle(`${label} ${amount}`, { exact: true })).toBeVisible()
}
