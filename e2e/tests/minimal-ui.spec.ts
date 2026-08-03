import { expect, test, type Page } from '@playwright/test'
import { assetRow } from './support/assets'
import { registerAndLogin } from './support/auth'

type SurfaceOffender = {
  element: string
  reason: 'shadow' | 'rounded-full-border'
  radius: number
  shadow: string
}

async function expectMinimalSurface(page: Page, screen: string) {
  const offenders = await page.locator('main').evaluate((main) => {
    const describe = (element: Element) => {
      const role = element.getAttribute('role')
      const label = element.getAttribute('aria-label')
      const text = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 48)
      return `${element.tagName.toLowerCase()}${role ? `[role="${role}"]` : ''}${label ? `[aria-label="${label}"]` : ''}${text ? `:${text}` : ''}`
    }

    return [main, ...main.querySelectorAll('*')].flatMap((element): SurfaceOffender[] => {
      if (
        element.matches('button, input, select, textarea, a, label, [role="radio"]')
        || element.closest('[role="dialog"], [role="menu"], [role="listbox"], aside[aria-live="polite"]')
      ) return []

      const style = getComputedStyle(element)
      const radius = Math.max(
        parseFloat(style.borderTopLeftRadius),
        parseFloat(style.borderTopRightRadius),
        parseFloat(style.borderBottomRightRadius),
        parseFloat(style.borderBottomLeftRadius),
      )
      const hasFullBorder = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .every((width) => parseFloat(width) > 0)

      if (style.boxShadow !== 'none') return [{ element: describe(element), reason: 'shadow', radius, shadow: style.boxShadow }]
      if (radius > 0 && hasFullBorder) return [{ element: describe(element), reason: 'rounded-full-border', radius, shadow: style.boxShadow }]
      return []
    })
  })

  expect(offenders, `${screen} 화면에 구조적 카드 surface가 없어야 합니다`).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow, `${screen} 화면에 가로 overflow가 없어야 합니다`).toBe(false)
}

test('가입·초대·홈·자산·설정·거래 폼은 카드 대신 구분선 중심의 평면 구조를 유지한다', async ({ page, request }) => {
  await page.goto('/sign-up')
  await expect(page.getByRole('heading', { name: '돈독 회원가입' })).toBeVisible()
  await expectMinimalSurface(page, '회원가입')

  await registerAndLogin(page, request, `미니멀 UI 사용자 ${test.info().workerIndex}`)
  await expectMinimalSurface(page, '가계부 시작')

  await page.goto('/join')
  await expect(page.getByRole('heading', { name: '받은 초대를 확인해요' })).toBeVisible()
  await expectMinimalSurface(page, '초대 참여')

  await page.getByRole('link', { name: '돌아가기' }).click()
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expectMinimalSurface(page, '가계부 홈')

  await page.getByRole('link', { name: '자산', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expectMinimalSurface(page, '자산 목록')

  await page.getByRole('link', { name: '자산 추가' }).click()
  await page.getByRole('group', { name: '자산 종류' }).getByRole('button', { name: '계좌', exact: true }).click()
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('미니멀 계좌')
  await page.getByLabel('최초 금액').fill('100000')
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toBeVisible()
  await expectMinimalSurface(page, '자산 등록 폼')
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  await expectMinimalSurface(page, '자산 등록 직후 목록')
  await assetRow(page, '미니멀 계좌').getByRole('link').click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expectMinimalSurface(page, '자산 상세 폼')

  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await expectMinimalSurface(page, '설정')

  await page.getByRole('link', { name: '기록', exact: true }).click()
  await expect(page.getByRole('heading', { name: '거래 기록' })).toBeVisible()
  await expect(page.getByRole('group', { name: '거래 종류' })).toBeVisible()
  await expectMinimalSurface(page, '거래 폼')
})
