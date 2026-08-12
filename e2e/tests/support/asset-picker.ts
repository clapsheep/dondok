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
  await picker.getByRole('button', { name: new RegExp(`^${escapeRegExp(assetName)},`) }).click()
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
