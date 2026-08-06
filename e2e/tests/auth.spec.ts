import { expect, test } from '@playwright/test'
import { mailToken } from './support/auth'

test('회원가입, 이메일 인증, 세션 로그인, 비밀번호 재설정과 새 비밀번호 로그인', async ({ page, request }) => {
  const suffix = `${Date.now()}${test.info().workerIndex}`
  const loginId = `dondok_${suffix}`
  const email = `${loginId}@example.test`
  const password = 'Dondok-pass-2026!'

  await page.goto('/sign-up')
  await page.getByLabel('아이디').fill(loginId)
  await page.getByRole('button', { name: '중복 확인' }).click()
  await expect(page.getByRole('button', { name: '확인 완료' })).toBeVisible()
  await page.getByLabel('이름').fill('돈독 테스트')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '가입하고 인증 메일 받기' }).click()
  await expect(page.getByRole('heading', { name: '이메일을 확인해 주세요' })).toBeVisible()

  const token = await mailToken(request, email, '이메일을 인증', 'verify-email')
  await page.goto(`/verify-email?token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { name: '인증이 완료됐어요' })).toBeVisible()
  await page.getByRole('link', { name: '로그인' }).click()

  await page.getByLabel('아이디').fill(loginId)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '초대 코드를 받으셨나요?' })).toBeVisible()

  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'DONDOK_SESSION')
  expect(sessionCookie).toBeDefined()
  expect(sessionCookie!.httpOnly).toBe(true)
  expect(sessionCookie!.sameSite).toBe('Lax')
  expect(sessionCookie!.expires).toBeGreaterThan(Date.now() / 1000 + 89 * 24 * 60 * 60)
  expect(sessionCookie!.expires).toBeLessThan(Date.now() / 1000 + 91 * 24 * 60 * 60)

  const browser = page.context().browser()
  expect(browser).not.toBeNull()
  const restoredContext = await browser!.newContext({ storageState: await page.context().storageState() })
  const restoredPage = await restoredContext.newPage()
  await restoredPage.goto(new URL(page.url()).origin)
  await expect(restoredPage.getByRole('heading', { name: '초대 코드를 받으셨나요?' })).toBeVisible()
  await restoredContext.close()

  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === 'DONDOK_SESSION')).toBe(false)
  await page.getByLabel('아이디').fill(loginId)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '초대 코드를 받으셨나요?' })).toBeVisible()

  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.getByRole('link', { name: '비밀번호를 잊었나요?' }).click()
  await page.getByLabel('이메일').fill(email)
  await page.getByRole('button', { name: '재설정 메일 받기' }).click()
  await expect(page.getByText('가입된 이메일이라면 재설정 안내를 보냈어요.')).toBeVisible()

  const resetToken = await mailToken(request, email, '비밀번호를 재설정', 'reset-password')
  const newPassword = 'Dondok-new-pass-2026!'
  await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`)
  await page.getByLabel('새 비밀번호', { exact: true }).fill(newPassword)
  await page.getByLabel('새 비밀번호 확인').fill(newPassword)
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('아이디').fill(loginId)
  await page.getByLabel('비밀번호').fill(newPassword)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '초대 코드를 받으셨나요?' })).toBeVisible()
})
