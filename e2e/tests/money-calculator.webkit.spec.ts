import { expect, test } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test.use({ serviceWorkers: 'block' })

test('설치형 PWA와 같은 WebKit에서도 앱 계산기로 원화 금액을 입력한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `WebKit 금액 계산기 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('grid', { name: /거래 달력/ })).toBeVisible()

  await page.goto('/transactions/new')
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await page.getByRole('button', { name: '다음', exact: true }).click()
  const amount = page.getByLabel('금액', { exact: true })
  await expect(amount).toHaveAttribute('inputmode', 'none')
  const calculator = page.getByRole('dialog', { name: '금액 계산기' })
  if (!await calculator.isVisible()) await amount.tap()
  await expect(calculator).toBeVisible()

  await calculator.getByRole('button', { name: '전체 지우기' }).tap()
  await calculator.getByRole('button', { name: '9 입력', exact: true }).tap()
  await calculator.getByRole('button', { name: '세 자리 0 입력' }).tap()
  await calculator.getByRole('button', { name: '더하기' }).tap()
  await calculator.getByRole('button', { name: '1 입력', exact: true }).tap()
  await calculator.getByRole('button', { name: '세 자리 0 입력' }).tap()
  await calculator.getByRole('button', { name: '계산 결과 적용' }).tap()
  await expect(amount).toHaveValue('10,000')
  await calculator.getByRole('button', { name: '완료' }).tap()
  await expect(calculator).toHaveCount(0)
})
