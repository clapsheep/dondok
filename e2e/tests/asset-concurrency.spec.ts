import { expect, test } from '@playwright/test'
import { openQuickAssetDetail } from './support/assets'
import { registerAndLogin } from './support/auth'

test('두 화면이 같은 자산을 수정하면 오래된 저장을 막고 입력을 최신 버전에 다시 적용한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `동시 수정 사용자 ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.getByRole('link', { name: '자산 추가' }).click()
  await openQuickAssetDetail(page, {
    typeName: '계좌',
    name: '동시 수정 계좌',
    amount: '500000',
    expectedName: '동시 수정 계좌',
    expectedAmount: '500,000원',
  })

  const detailUrl = page.url()
  const otherPage = await page.context().newPage()
  await otherPage.goto(detailUrl)
  await expect(otherPage.getByRole('heading', { name: '자산 정보 수정' })).toBeVisible()

  await page.getByLabel('메모 (선택)').fill('첫 번째 화면에서 저장')
  await page.getByRole('button', { name: '변경 저장' }).click()
  await expect(page.getByRole('status')).toContainText('자산 정보를 저장했어요')

  await otherPage.getByLabel('자산 이름 (선택)', { exact: true }).fill('')
  await otherPage.getByRole('button', { name: '변경 저장' }).click()
  const conflict = otherPage.getByRole('alert').filter({ has: otherPage.getByRole('heading', { name: '다른 구성원이 먼저 수정했어요' }) })
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText('첫 번째 화면에서 저장')
  await expect(conflict, '빈 이름 draft는 충돌 비교에서 다음 선택 유형 이름으로 표시해야 합니다').toContainText('계좌 2')
  await expect(otherPage.getByLabel('자산 이름 (선택)', { exact: true }), '412 뒤에는 사용자가 비운 draft를 보존해야 합니다').toHaveValue('')

  await otherPage.getByRole('button', { name: '최신 버전으로 저장 준비' }).click()
  await expect(otherPage.getByRole('status')).toContainText('최신 버전에 내 입력을 적용할 준비가 됐어요')
  await otherPage.getByRole('button', { name: '변경 저장' }).click()
  await expect(otherPage.getByRole('status')).toContainText('자산 정보를 저장했어요')
  await expect(otherPage.getByLabel('자산 이름 (선택)', { exact: true })).toHaveValue('계좌 2')

  await otherPage.close()
})
