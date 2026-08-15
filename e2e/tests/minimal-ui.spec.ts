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
        element.matches('button, input, select, textarea, a, label, [role="radio"], [role="switch"]')
        || element.closest('[role="switch"]')
        || element.matches('[data-member-avatar], [data-joint-avatar], [data-financial-institution-avatar]')
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

async function expectHomeResponsiveLayout(page: Page) {
  const viewport = page.viewportSize()
  const calendar = page.getByRole('grid', { name: /거래 달력$/ })
  const summary = page.locator('[data-home-desktop-summary]')
  await expect(calendar).toBeVisible()
  await expect(summary).toBeVisible()
  const [calendarBox, summaryBox] = await Promise.all([calendar.boundingBox(), summary.boundingBox()])
  expect(calendarBox).not.toBeNull()
  expect(summaryBox).not.toBeNull()
  if ((viewport?.width ?? 0) >= 1024) {
    expect(summaryBox!.x, '데스크톱은 달력 오른쪽에 이번 달 요약 rail을 둔다').toBeGreaterThanOrEqual(calendarBox!.x + calendarBox!.width)
    return
  }
  expect(summaryBox!.y + summaryBox!.height, '모바일·iPad 세로는 요약을 달력 위의 읽기 흐름에 둔다').toBeLessThanOrEqual(calendarBox!.y)
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
  await expectHomeResponsiveLayout(page)
  await expectMinimalSurface(page, '가계부 홈')

  await page.getByRole('link', { name: '자산', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expectMinimalSurface(page, '자산 목록')

  await page.getByRole('link', { name: '자산 추가' }).click()
  await page.getByRole('group', { name: '자산 종류' }).getByRole('button', { name: '계좌', exact: true }).click()
  await page.getByLabel('자산 이름 (선택)', { exact: true }).fill('미니멀 계좌')
  await page.getByLabel('기준일 잔액').fill('100000')
  await expect(page.getByLabel('자산 이름 (선택)', { exact: true })).toBeVisible()
  await expectMinimalSurface(page, '자산 등록 폼')
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('자산을 등록했어요.')
  await expectMinimalSurface(page, '자산 등록 직후 목록')
  await assetRow(page, '미니멀 계좌').getByRole('link').click()
  await page.getByRole('link', { name: '자산 편집' }).click()
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

test('모바일은 설정을 5번째 dock 탭으로 제공하고 로그아웃을 설정 안에 둔다', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await registerAndLogin(page, request, `모바일 설정 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  await expect(page.locator('main > header')).toHaveCount(0)

  const dock = page.getByRole('navigation', { name: '주요 메뉴' })
  const dockLinks = dock.getByRole('link')
  await expect(dockLinks).toHaveCount(5)
  for (const name of ['홈', '기록', '자산', '통계', '설정']) {
    const link = dock.getByRole('link', { name, exact: true })
    await expect(link).toBeVisible()
    const box = await link.boundingBox()
    expect(box, `${name} 탭 조작 영역`).not.toBeNull()
    expect(box!.width, `${name} 탭 너비`).toBeGreaterThanOrEqual(44)
    expect(box!.height, `${name} 탭 높이`).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

  await dock.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await expect(page.getByRole('link', { name: '가계부로 돌아가기', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('모바일 탭 이동 중 하단 dock DOM과 위치를 유지한다', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await registerAndLogin(page, request, `모바일 dock 안정성 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  const dock = page.getByRole('navigation', { name: '주요 메뉴' })
  const initialBox = await dock.boundingBox()
  expect(initialBox).not.toBeNull()
  await dock.evaluate((element) => {
    ;(window as Window & { __dondokMobileDock?: Element }).__dondokMobileDock = element
  })

  await dock.getByRole('link', { name: '자산', exact: true }).click()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()

  const dockState = await page.evaluate(() => {
    const preservedDock = (window as Window & { __dondokMobileDock?: Element }).__dondokMobileDock
    const currentDock = document.querySelector('[data-mobile-navigation]')
    return {
      sameNode: preservedDock === currentDock,
      preservedNodeStillConnected: preservedDock?.isConnected ?? false,
    }
  })
  expect(dockState).toEqual({ sameNode: true, preservedNodeStillConnected: true })

  const nextBox = await dock.boundingBox()
  expect(nextBox).not.toBeNull()
  expect(Math.abs(nextBox!.x - initialBox!.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(nextBox!.y - initialBox!.y)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(nextBox!.width - initialBox!.width)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(nextBox!.height - initialBox!.height)).toBeLessThanOrEqual(0.5)
})
