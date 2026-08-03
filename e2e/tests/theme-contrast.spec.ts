import { expect, test, type Locator } from '@playwright/test'

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
