import { expect, test, type Locator } from '@playwright/test'
import { registerAndLogin } from './support/auth'

type Rgb = { red: number; green: number; blue: number }

function rgb(value: string): Rgb {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`)
  return { red: channels[0], green: channels[1], blue: channels[2] }
}

function luminance({ red, green, blue }: Rgb) {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

async function contrastRatio(locator: Locator) {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return { foreground: style.color, background: style.backgroundColor }
  })
  const foreground = luminance(rgb(colors.foreground))
  const background = luminance(rgb(colors.background))
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
}

test('라이트·다크 모드의 보조 버튼은 hover 중에도 읽을 수 있다', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => window.localStorage.setItem('dondok-theme', 'light'))
  await page.goto('/sign-up')
  await page.getByLabel('아이디').fill('contrast_test')

  const duplicateButton = page.getByRole('button', { name: '중복 확인' })
  await duplicateButton.hover()
  await page.waitForTimeout(200)
  expect(await contrastRatio(duplicateButton)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('button', { name: '밝은 테마 사용 중. 어두운 테마로 변경' }).click()
  await duplicateButton.hover()
  await page.waitForTimeout(200)
  expect(await contrastRatio(duplicateButton)).toBeGreaterThanOrEqual(4.5)
  const darkColors = await duplicateButton.evaluate((element) => {
    const style = getComputedStyle(element)
    return { foreground: style.color, background: style.backgroundColor }
  })
  expect(luminance(rgb(darkColors.foreground))).toBeGreaterThan(luminance(rgb(darkColors.background)))
})

test('다크 모드의 거래 입력과 선택·navigation 상태는 배경 위에서 읽을 수 있다', async ({ page, request }) => {
  await page.addInitScript(() => window.localStorage.setItem('dondok-theme', 'dark'))
  await registerAndLogin(page, request, `다크 대비 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  const primaryNavigation = page.getByRole('navigation', { name: '주요 메뉴' })
    .or(page.getByRole('complementary', { name: '주요 메뉴' }).getByRole('navigation'))
  await primaryNavigation.getByRole('link', { name: '기록', exact: true }).click()

  const performer = page.getByRole('radiogroup', { name: '누가 썼나요?' })
  const selectedRadio = page.getByRole('radio', { checked: true })
  const selectedPerson = page.locator('[data-slot="member-picker"] label').filter({ has: selectedRadio })
  const selectedAvatar = selectedPerson.locator('[data-member-avatar]')
  const selectedType = page.getByRole('group', { name: '거래 종류' }).getByRole('button', { name: '지출', exact: true })
  const amount = page.getByLabel('금액', { exact: true })
  const date = page.getByLabel('날짜', { exact: true })
  const activeNavigation = primaryNavigation.getByRole('link', { name: '기록', exact: true })

  await expect(selectedRadio).toBeChecked()
  await expect(selectedType).toHaveAttribute('aria-pressed', 'true')
  await expect(activeNavigation).toHaveAttribute('aria-current', 'page')

  for (const [name, target] of [
    ['선택한 사람', selectedPerson],
    ['선택한 사람 아바타', selectedAvatar],
    ['선택한 거래 종류', selectedType],
    ['금액 입력', amount],
    ['날짜 입력', date],
    ['활성 navigation', activeNavigation],
  ] as const) {
    expect(await contrastRatioAgainstSurface(target), `다크 모드 ${name} 대비`).toBeGreaterThanOrEqual(4.5)
  }
})

test('테마 선택은 모바일과 데스크톱 앱 셀에서 같은 상태를 본다', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '하나의 브라우저에서 breakpoint를 넘는 회귀만 검증합니다.')
  await page.addInitScript(() => window.localStorage.setItem('dondok-theme', 'light'))
  await registerAndLogin(page, request, '테마 동기화 사용자')
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.setViewportSize({ width: 390, height: 844 })

  await page.getByRole('button', { name: '밝은 테마 사용 중. 어두운 테마로 변경' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('button', { name: '어두운 테마 사용 중. 시스템 테마로 변경' })).toBeVisible()

  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.getByRole('complementary', { name: '주요 메뉴' }).getByRole('button', { name: '어두운 테마 사용 중. 시스템 테마로 변경' })).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
})

async function contrastRatioAgainstSurface(locator: Locator) {
  const colors = await locator.evaluate((element) => {
    const foreground = getComputedStyle(element).color
    let current: Element | null = element
    while (current) {
      const background = getComputedStyle(current).backgroundColor
      if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return { foreground, background }
      current = current.parentElement
    }
    return { foreground, background: getComputedStyle(document.documentElement).backgroundColor }
  })
  const foreground = luminance(rgb(colors.foreground))
  const background = luminance(rgb(colors.background))
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
}
