import { expect, test, type Page } from '@playwright/test'
import { assetRow } from './support/assets'
import { registerAndLogin } from './support/auth'

async function expectMinimalSurface(page: Page, screen: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${screen} 가로 overflow`).toBe(false)
  const panels = page.locator('.ui-soft-panel:visible, .home-summary:visible, .home-day-panel:visible')
  for(const panel of await panels.all()) {
    const style = await panel.evaluate(element => { const s=getComputedStyle(element); return { radius:parseFloat(s.borderTopLeftRadius), border:parseFloat(s.borderTopWidth) } })
    expect(style.radius, `${screen} 부드러운 공통 패널`).toBeGreaterThanOrEqual(14)
    expect(style.border, `${screen} 패널은 강한 구분선을 쓰지 않습니다`).toBeLessThanOrEqual(1)
  }
}

async function expectHomeResponsiveLayout(page: Page) {
  const calendar = page.getByRole('grid', { name: /거래 달력$/ })
  const summary = page.locator('[data-home-desktop-summary]')
  await expect(calendar).toBeVisible()
  await expect(summary).toBeVisible()
  const a=await summary.boundingBox(), b=await calendar.boundingBox()
  expect(a!.y+a!.height).toBeLessThanOrEqual(b!.y)
}

test('가입·초대·홈·자산·설정·거래 폼은 새 패널 스타일과 가로 여백을 유지한다', async ({ page, request }) => {
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
  await expect(page.getByRole('status').filter({ hasText: '자산을 등록했어요.' })).toBeVisible()
  await expectMinimalSurface(page, '자산 등록 직후 목록')
  await assetRow(page, '미니멀 계좌').getByRole('link').click()
  await page.getByRole('link', { name: '자산 편집' }).click()
  await expect(page.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()
  await expectMinimalSurface(page, '자산 상세 폼')

  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await expectMinimalSurface(page, '설정')

  await page.getByRole('link', { name: '기록', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^(기록|어떤 거래인가요\?)$/ })).toBeVisible()
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
  await page.getByRole('button', { name: '내 계정', exact: true }).click()
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
