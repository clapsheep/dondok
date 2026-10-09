import { expect, type Page } from '@playwright/test'

export async function expectRecordActions(page: Page, title: string, labels: string[]) {
  const heading = page.getByRole('heading', { name: title, exact: true })
  await expect(heading).toBeVisible()
  const titleBox = await heading.boundingBox()
  if (!titleBox) throw new Error('상세 제목이 보이지 않습니다.')
  for (const label of labels) {
    const action = page.getByRole('link', { name: label, exact: true })
    await expect(action).toBeVisible()
    await expect(action).toHaveAttribute('title', label)
    const box = await action.boundingBox()
    if (!box) throw new Error(`${label} 아이콘이 보이지 않습니다.`)
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 1)
    expect(Math.abs(box.y + box.height / 2 - titleBox.y - titleBox.height / 2)).toBeLessThan(2)
    await expect(action.locator('svg')).toHaveCount(1)
  }
  await expect(page.getByRole('button', { name: '기록 삭제', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '관리', exact: true })).toHaveCount(0)
}
