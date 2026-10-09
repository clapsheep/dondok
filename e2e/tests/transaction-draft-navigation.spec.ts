import { fillRecordField } from './support/record-steps'
import { expect, test } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test('홈에서 진입한 변경된 거래 초안만 이탈 전에 확인한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `거래 이탈 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()

  await expect(page.locator('[data-home-header]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '가계부', level: 1, exact: true })).toBeVisible()

  await page.getByRole('link', { name: '기록', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^(기록|어떤 거래인가요\?)$/, level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: '취소', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '취소', exact: true })).toHaveCount(0)

  await fillRecordField(page, '금액', '12,345')
  await fillRecordField(page, '내용 (선택)', '나가기 전에 지킬 초안')
  await page.getByRole('link', { name: '자산', exact: true }).click()

  const leaveDialog = page.getByRole('dialog', { name: '작성 중인 기록을 나갈까요?' })
  await expect(leaveDialog).toBeVisible()
  await expect(leaveDialog).toContainText('입력한 내용은 저장되지 않고 모두 사라져요.')
  await leaveDialog.getByRole('button', { name: '계속 작성' }).click()
  await expect(leaveDialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/transactions\/new$/)
  await expect(page.getByLabel('금액', { exact: true })).toHaveValue('12,345')
  await expect(page.getByLabel('내용 (선택)')).toHaveValue('나가기 전에 지킬 초안')

  await page.getByRole('link', { name: '자산', exact: true }).click()
  await leaveDialog.getByRole('button', { name: '나가기' }).click()
  await expect(page).toHaveURL(/\/assets$/)
  await expect(page.getByRole('heading', { name: '자산 현황', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: '기록', exact: true }).click()
  await expect(page.getByLabel('금액', { exact: true })).toHaveValue('')
  await page.getByRole('link', { name: '홈', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('dialog', { name: '작성 중인 기록을 나갈까요?' })).toHaveCount(0)
})

test('변경된 거래 초안은 브라우저 새로고침 전에도 표준 경고로 보호한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `새로고침 보호 QC ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.getByRole('link', { name: '기록', exact: true }).click()
  await fillRecordField(page, '내용 (선택)', '새로고침에서 지킬 초안')

  const prompt = page.waitForEvent('dialog')
  const reload = page.reload()
  const dialog = await prompt
  expect(dialog.type()).toBe('beforeunload')
  await dialog.accept()
  await reload

  await expect(page).toHaveURL(/\/transactions\/new$/)
  await expect(page.getByLabel('내용 (선택)')).toHaveValue('')
})
