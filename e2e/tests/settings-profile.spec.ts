import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { registerAndLogin } from './support/auth'

async function command(request: APIRequestContext, path: string, body: unknown, method = 'POST') {
  const csrf = await (await request.get('/api/auth/csrf')).json()
  return request.fetch(path, { method, data: body, headers: { [csrf.headerName]: csrf.token } })
}
async function login(page: Page, loginId: string, password: string) {
  await page.goto('/login'); await page.getByLabel('아이디').fill(loginId)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
async function emailCode(request: APIRequestContext, email: string) {
  const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'
  let id = ''
  await expect.poll(async () => {
    const data = await (await request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()
    id = data.messages.find((message: { Subject: string }) => message.Subject.includes('이메일 변경 인증번호'))?.ID ?? ''
    return id
  }).not.toBe('')
  const message = await (await request.get(`${mailpit}/api/v1/message/${id}`)).json()
  return (message.Text as string).match(/인증번호는 (\d{8})/)![1]
}

test('내 계정에서 이름과 인증된 이메일을 비밀번호 확인 후 저장한다', async ({ page, request }) => {
  const account = await registerAndLogin(page, request, '프로필 테스트')
  await page.goto('/settings?section=account')
  const form = page.getByRole('region', { name: '프로필 수정' })
  await form.getByLabel('이름', { exact: true }).fill('변경한 이름')
  await form.getByLabel('현재 비밀번호').fill('wrong-password')
  await form.getByRole('button', { name: '계정 정보 저장' }).click()
  await expect(form.getByRole('alert')).toContainText('현재 비밀번호가 일치하지')
  await form.getByLabel('현재 비밀번호').fill(account.password)
  const originalViewport = page.viewportSize()!
  await page.setViewportSize({ width: 320, height: 720 })
  await expect(form.getByLabel('이름', { exact: true })).toHaveValue('변경한 이름')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize(originalViewport)
  await form.getByRole('button', { name: '계정 정보 저장' }).click()
  await expect(form.getByRole('status')).toContainText('계정 정보를 저장했어요')
  const target = `changed-${randomUUID()}@example.test`
  await form.getByLabel('이메일', { exact: true }).fill(target)
  await form.getByLabel('현재 비밀번호').fill(account.password)
  await expect(form.getByRole('button', { name: '계정 정보 저장' })).toBeDisabled()
  await form.getByRole('button', { name: '인증번호 받기', exact: true }).click()
  const code = await emailCode(request, target)
  await form.getByLabel('이메일 인증번호').fill(code === '00000000' ? '11111111' : '00000000')
  await form.getByRole('button', { name: '인증번호 확인', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('인증번호가 틀렸거나 만료')
  await form.getByLabel('이메일 인증번호').fill(code)
  await form.getByRole('button', { name: '인증번호 확인', exact: true }).click()
  await expect(form.getByText('이메일 인증 완료.', { exact: false })).toBeVisible()
  expect((await (await page.request.get('/api/auth/me')).json()).email).toBe(account.email)
  await form.getByRole('button', { name: '계정 정보 저장' }).click()
  await expect(form.getByRole('status')).toContainText('계정 정보를 저장했어요')
  await page.reload()
  await expect(form.getByLabel('이메일', { exact: true })).toHaveValue(target)
  await expect(form.getByLabel('이름', { exact: true })).toHaveValue('변경한 이름')
})

test('다른 세션 수정 시 draft를 보존하고 확인 후 다시 저장한다', async ({ page, request, browser }) => {
  const account = await registerAndLogin(page, request, '동시 수정')
  await page.goto('/settings?section=account')
  const form = page.getByRole('region', { name: '프로필 수정' })
  await form.getByLabel('이름', { exact: true }).fill('내 입력 유지')
  await form.getByLabel('현재 비밀번호').fill(account.password)
  const other = await browser.newContext(); const otherPage = await other.newPage()
  try {
    await login(otherPage, account.loginId, account.password)
    const profile = await (await other.request.get('/api/auth/profile')).json()
    expect((await command(other.request, '/api/auth/profile', { displayName: '다른 화면 이름', email: account.email, password: account.password, expectedVersion: profile.version }, 'PUT')).ok()).toBe(true)
    await form.getByRole('button', { name: '계정 정보 저장' }).click()
    await expect(form.getByRole('alert')).toContainText('다른 화면에서 계정 정보가 변경')
    await expect(form.getByLabel('이름', { exact: true })).toHaveValue('내 입력 유지')
    await form.getByRole('button', { name: '최신 정보 확인' }).click()
    await expect(form.getByText('현재 저장된 이름: 다른 화면 이름', { exact: false })).toBeVisible()
    await form.getByRole('button', { name: '확인했어요 · 입력 내용 유지' }).click()
    await form.getByRole('button', { name: '계정 정보 저장' }).click()
    await expect(form.getByRole('status')).toContainText('계정 정보를 저장했어요')
    expect((await (await other.request.get('/api/auth/me')).json()).displayName).toBe('내 입력 유지')
  } finally { await other.close() }
})

test('비밀번호 확인과 새 비밀번호 일치를 검사하고 모든 세션을 종료한다', async ({ page, request, browser }) => {
  const account = await registerAndLogin(page, request, '비밀번호 테스트')
  const other = await browser.newContext(); const otherPage = await other.newPage()
  try {
    await login(otherPage, account.loginId, account.password)
    await page.goto('/settings?section=account')
    await expect(page.getByLabel('새 비밀번호', { exact: true })).toHaveCount(0)
    await page.getByRole('region', { name: '프로필 수정' }).getByRole('link', { name: '비밀번호 변경', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/password$/)
    await expect(page.getByRole('region', { name: '프로필 수정' })).toHaveCount(0)
    await page.getByRole('link', { name: '내 계정으로 돌아가기' }).click()
    await expect(page).toHaveURL(/\/settings\?section=account$/)
    await page.getByRole('link', { name: '비밀번호 변경', exact: true }).click()
    await page.reload()
    const form = page.getByRole('region', { name: '비밀번호 변경' })
    await form.getByLabel('기존 비밀번호').fill('wrong-password')
    await form.getByLabel('새 비밀번호', { exact: true }).fill('New-password-2026!')
    await form.getByLabel('새 비밀번호 확인').fill('Mismatch-password!')
    await form.getByRole('button', { name: '비밀번호 변경', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('새 비밀번호가 서로 달라요')
    await form.getByLabel('새 비밀번호 확인').fill('New-password-2026!')
    await form.getByRole('button', { name: '비밀번호 변경', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('현재 비밀번호가 일치하지')
    await form.getByLabel('기존 비밀번호').fill(account.password)
    await form.getByRole('button', { name: '비밀번호 변경', exact: true }).click()
    await expect(page).toHaveURL(/\/login\?passwordChanged=1/)
    await expect(page.getByRole('status').filter({ hasText: '비밀번호를 변경했어요' })).toBeVisible()
    expect((await other.request.get('/api/auth/me')).status()).toBe(401)
    await page.getByLabel('아이디').fill(account.loginId)
    await page.getByLabel('비밀번호', { exact: true }).fill(account.password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('아이디 또는 비밀번호를 확인')
    await login(page, account.loginId, 'New-password-2026!')
  } finally { await other.close() }
})
