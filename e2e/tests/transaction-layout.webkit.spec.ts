import { expect, test, type Page } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test('모바일 Safari 거래 금액과 날짜가 화면 폭 안에 같은 크기로 놓인다', async ({ page, request }) => {
  await registerAndLogin(page, request, `Safari 거래 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await recordNavigation(page).click()

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('heading', { name: '거래 기록', level: 1 })).toBeVisible()

    const geometry = await page.evaluate(() => {
      const amount = document.querySelector<HTMLElement>('[data-slot="money-field"]')
      const dateInput = document.querySelector<HTMLInputElement>('#transactionDate')
      const date = dateInput?.closest<HTMLElement>('[data-slot="field"]')
      if (!amount || !date || !dateInput) throw new Error('거래 금액 또는 날짜 field를 찾지 못했습니다.')

      const amountRect = amount.getBoundingClientRect()
      const dateRect = date.getBoundingClientRect()
      const dateInputRect = dateInput.getBoundingClientRect()
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        amountTop: amountRect.top,
        amountWidth: amountRect.width,
        dateTop: dateRect.top,
        dateWidth: dateRect.width,
        dateInputRight: dateInputRect.right,
        dateInputInlinePadding: Number.parseFloat(getComputedStyle(dateInput).paddingLeft)
          + Number.parseFloat(getComputedStyle(dateInput).paddingRight),
      }
    })

    expect(geometry.dateInputInlinePadding, 'iOS WebKit의 date width 계산 오류를 피하려면 input 자체의 좌우 padding이 없어야 합니다').toBe(0)
    expect(geometry.pageWidth, `${viewport.width}px에서 페이지 가로 스크롤이 생기면 안 됩니다`).toBe(geometry.viewportWidth)
    expect(geometry.dateInputRight, `${viewport.width}px에서 날짜 입력 오른쪽 경계가 화면 안에 있어야 합니다`).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(Math.abs(geometry.amountTop - geometry.dateTop), `${viewport.width}px에서 금액과 날짜는 같은 행이어야 합니다`).toBeLessThanOrEqual(1)
    expect(Math.abs(geometry.amountWidth - geometry.dateWidth), `${viewport.width}px에서 금액과 날짜는 같은 폭이어야 합니다`).toBeLessThanOrEqual(2)
  }
})

test('모바일 Safari에서 자산 탭 진입 중 하단 dock이 교체되거나 움직이지 않는다', async ({ page, request }) => {
  await registerAndLogin(page, request, `Safari dock ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()

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

function recordNavigation(page: Page) {
  return page.getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('link', { name: '기록', exact: true })
}
