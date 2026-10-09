import { expect, type Locator, type Page } from '@playwright/test'

/** Navigate the same mobile form a user sees; desktop keeps every panel visible. */
export async function showRecordStep(page: Page, step: number) {
  const editor = page.locator('.transaction-record')
  if (new URL(page.url()).pathname.startsWith('/transactions/') && /\/(new|edit|correction|refund)$/.test(new URL(page.url()).pathname)) await editor.waitFor({ state: 'attached' })
  if (!await editor.count()) return
  const panel = editor.locator(`[data-record-panel="${step}"]`)
  if (await panel.isVisible()) return
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = Number(await editor.getAttribute('data-record-step'))
    if (current === step) break
    await editor.getByRole('button', { name: current < step ? '다음' : '이전 단계', exact: true }).click()
    await expect(editor).toHaveAttribute('data-record-step', String(current + (current < step ? 1 : -1)))
  }
  await expect(panel).toBeVisible()
}

export async function fillRecordField(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true })
  await showRecordField(page, field)
  await field.fill(value)
}

export async function showRecordField(page: Page, field: Locator) {
  await field.waitFor({ state: 'attached' })
  const panel = field.locator('xpath=ancestor::*[@data-record-panel][1]')
  if(await panel.count()) await showRecordStep(page, Number(await panel.getAttribute('data-record-panel')))
}

export async function showCardPaymentStep(page: Page, step: 1 | 2) {
  const section = page.getByRole('region', { name: '카드 대금 결제', exact: true })
  if (!await section.count()) return
  const button = section.getByRole('button', { name: step === 1 ? '이전 결제 단계' : '다음', exact: true })
  if(await button.isVisible()) await button.click()
}
