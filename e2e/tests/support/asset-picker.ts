import { expect, type Locator, type Page } from '@playwright/test'

type PickerScope = Page | Locator

export function assetPickerTrigger(scope: PickerScope, label: string) {
  return scope.getByRole('button', { name: label, exact: true })
}

export async function openAssetPicker(page: Page, label: string, scope: PickerScope = page) {
  const trigger = assetPickerTrigger(scope, label)
  await trigger.click()
  const picker = page.getByRole('dialog', { name: `${label} 선택`, exact: true })
  await expect(picker).toBeVisible()
  return { trigger, picker }
}

export async function selectAsset(page: Page, label: string, assetName: string, scope: PickerScope = page) {
  const { trigger, picker } = await openAssetPicker(page, label, scope)
  const option = picker.getByRole('button', { name: new RegExp(`^${escapeRegExp(assetName)},`) })
  if (!await option.count()) {
    await picker.getByRole('switch', { name: '모든 자산 보기', exact: true }).click()
  }
  await option.click()
  await expect(picker).toHaveCount(0)
  await expect(trigger).toContainText(assetName)
  await expect(trigger).toBeFocused()
  return trigger
}

export async function expectResponsiveAssetPicker(page: Page, trigger: Locator, picker: Locator) {
  const viewport = page.viewportSize()
  const triggerBox = await trigger.boundingBox()
  const pickerBox = await picker.boundingBox()
  expect(viewport).not.toBeNull()
  expect(triggerBox).not.toBeNull()
  expect(pickerBox).not.toBeNull()
  if (!viewport || !triggerBox || !pickerBox) return

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  if (viewport.width < 768) {
    expect(Math.abs(pickerBox.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(pickerBox.width - viewport.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(pickerBox.y + pickerBox.height - viewport.height)).toBeLessThanOrEqual(2)
    expect(triggerBox.height, '모바일 자산 선택 trigger가 카드처럼 높아지면 안 됩니다').toBeLessThanOrEqual(52)

    const optionHeights = await picker.locator('[data-asset-option]').evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height))
    expect(optionHeights.length).toBeGreaterThan(0)
    expect(optionHeights.every((height) => height >= 44 && height <= 58), '모바일 자산 option은 44px 조작 영역을 지키는 compact 행이어야 합니다').toBe(true)

    const filter = picker.getByRole('group', { name: '자산 종류 필터' })
    if (await filter.count()) {
      const filterRows = await filter.getByRole('button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)))
      expect(new Set(filterRows).size, '모바일 자산 종류 필터는 줄바꿈하지 않아야 합니다').toBe(1)
    }
  } else {
    expect(pickerBox.width).toBeLessThan(viewport.width - 16)
    const gapBelow = Math.abs(pickerBox.y - (triggerBox.y + triggerBox.height))
    const gapAbove = Math.abs(triggerBox.y - (pickerBox.y + pickerBox.height))
    expect(Math.min(gapBelow, gapAbove)).toBeLessThanOrEqual(10)
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
