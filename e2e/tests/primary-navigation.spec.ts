import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`${theme} 상단 메뉴와 태블릿 rail은 전환·선택·스크롤에도 위치와 포커스를 유지한다`, async ({ page }, testInfo) => {
    const ledger = {
      ledgerId: 'sidebar-test-ledger', version: 1,
      members: [{ memberId: 'sidebar-test-member', displayName: '미리보기', joinedAt: '2026-01-01T00:00:00Z', currentUser: true }],
    }
    await testInfo.attach('seed-manifest', { body: JSON.stringify({ mode: 'mocked API; no mutations', ledger }), contentType: 'application/json' })
    await page.addInitScript((value) => localStorage.setItem('dondok-theme', value), theme)
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      const data = path === '/api/auth/me'
        ? { userId: 'sidebar-test-user', loginId: 'preview', displayName: '미리보기', email: 'preview@example.com' }
        : path === '/api/ledger-books/current' ? { ledger } : []
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': 'sidebar-navigation-test' }, body: JSON.stringify(data) })
    })
    await page.goto('/settings')
    const sidebar = page.getByRole('complementary', { name: '주요 메뉴' })
    const settings = sidebar.getByRole('link', { name: '설정', exact: true })
    const assets = sidebar.getByRole('link', { name: '자산', exact: true })
    for (const width of [1280, 1920, 1279, 834, 1280]) {
      await page.setViewportSize({ width, height: 950 })
      await expect(settings).toHaveAttribute('aria-current', 'page')
      await expect(assets).not.toHaveAttribute('aria-current', 'page')
      await expect(sidebar).toHaveCSS('width', width >= 1280 ? `${width}px` : '80px')
      await expect(page.getByRole('main')).toHaveCSS('margin-left', width >= 1280 ? '0px' : '80px')
      if (width >= 1280) {
        await expect(sidebar).toHaveCSS('height', '64px')
        await expect(page.getByRole('main')).toHaveCSS('padding-top', '64px')
        const home = sidebar.getByRole('link', { name: '홈', exact: true })
        expect((await assets.boundingBox())!.y).toBe((await home.boundingBox())!.y)
        expect((await assets.boundingBox())!.x).toBeGreaterThan((await home.boundingBox())!.x)
        await expect(assets.locator('svg')).toBeHidden()
      } else {
        expect((await assets.locator('svg').boundingBox())!.x).toBe((await settings.locator('svg').boundingBox())!.x)
      }
      const beforeHover = await assets.boundingBox()
      await assets.hover()
      expect(await assets.boundingBox()).toEqual(beforeHover)
      await assets.focus()
      await expect(assets).toBeFocused()
    }
    await page.setViewportSize({ width: 1440, height: 950 })
    await expect(assets).toBeFocused()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    expect((await sidebar.boundingBox())!.y).toBe(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.setViewportSize({ width: 1440, height: 950 })
    const beforeSelection = await assets.boundingBox()
    await assets.click()
    await expect(page.getByRole('heading', { name: '자산 현황' })).toBeVisible()
    await expect(assets).toHaveAttribute('aria-current', 'page')
    await expect(settings).not.toHaveAttribute('aria-current', 'page')
    expect((await assets.boundingBox())!.x).toBe(beforeSelection!.x)
    await page.screenshot({ path: testInfo.outputPath(`desktop-${theme}.png`), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '자산', exact: true })).toHaveAttribute('aria-current', 'page')
  })
}
