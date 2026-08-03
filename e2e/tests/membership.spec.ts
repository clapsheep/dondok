import { expect, test } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test('가계부 생성자가 초대하고 다른 사용자가 참여하면 양쪽에서 구성원을 확인한다', async ({ page, request }) => {
  const ownerName = `초대한 사람 ${test.info().workerIndex}`
  const memberName = `참여한 사람 ${test.info().workerIndex}`
  const owner = await registerAndLogin(page, request, ownerName)

  await expect(page.getByLabel('가계부 이름')).toHaveCount(0)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByText(ownerName, { exact: true })).toHaveCount(0)

  await expect(page.getByRole('button', { name: '새 초대' })).toHaveCount(0)
  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '새 초대' }).click()
  const invitationCode = await page.getByRole('status', { name: '초대 코드' }).textContent()
  expect(invitationCode).toBeTruthy()
  await expect(page.getByText('초대가 준비됐어요')).toBeVisible()

  await page.getByRole('button', { name: '로그아웃' }).click()
  await registerAndLogin(page, request, memberName)
  await page.goto(`/join?code=${encodeURIComponent(invitationCode!)}`)
  await expect(page.getByRole('heading', { name: '가계부 초대' })).toBeVisible()
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '참여하기' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '가계부 초대' })).toHaveCount(0)
  await expect(page.getByText(ownerName, { exact: true })).toHaveCount(0)
  await expect(page.getByText(memberName, { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible()
  await expect(page.getByText(memberName, { exact: true })).toBeVisible()

  await page.goto(`/join?code=${encodeURIComponent(invitationCode!)}`)
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.getByLabel('아이디').fill(owner.loginId)
  await page.getByLabel('비밀번호').fill(owner.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByText(memberName, { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await expect(page.getByText(memberName, { exact: true })).toBeVisible()
  await expect(page.getByText('사용 완료', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '기록', exact: true }).click()
  const performerGroup = page.getByRole('radiogroup', { name: '누가 썼나요?' })
  await expect(performerGroup).toBeVisible()
  await expect(page.getByRole('radio', { name: new RegExp(ownerName) })).toBeChecked()
  await page.getByRole('radio', { name: new RegExp(memberName) }).click()
  await expect(page.getByRole('radio', { name: new RegExp(memberName) })).toBeChecked()
  await page.getByRole('button', { name: '수입', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: '누가 받았나요?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: new RegExp(memberName) })).toBeChecked()
})
