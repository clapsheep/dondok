import { expect, test, type Locator } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test('주요 메뉴의 대제목은 같은 크기와 굵기를 유지한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `제목 일관성 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', level: 1, exact: true })).toBeVisible()

  const titleStyles = []
  for (const [path, title] of [
    ['/', '가계부'],
    ['/assets', '자산 현황'],
    ['/statistics', '월간 통계'],
    ['/settings', '가계부 설정'],
  ] as const) {
    await page.goto(path)
    const heading = page.getByRole('heading', { name: title, level: 1, exact: true })
    await expect(heading).toBeVisible()
    titleStyles.push(await headingStyle(heading))
  }

  for (const style of titleStyles) {
    expect(style.fontSize, '주요 메뉴 대제목은 모두 24px이어야 합니다').toBe(24)
    expect(style.fontWeight, '주요 메뉴 대제목은 모두 같은 semibold 굵기여야 합니다').toBe(600)
  }
})

async function headingStyle(heading: Locator) {
  return heading.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
    }
  })
}
