import { expect, type Page } from '@playwright/test'

export function transactionCategoryTrigger(page: Page) {
  return page.getByRole('button', { name: /^분류 선택, 현재 / })
}

export async function selectTransactionCategory(page: Page, name: string) {
  const trigger = transactionCategoryTrigger(page)
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: /분류 선택$/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toContainText(name)
}
