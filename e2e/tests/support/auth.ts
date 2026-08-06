import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

type MessageSummary = { ID: string; Subject: string; To: Array<{ Address: string }> }
type MessageList = { messages: MessageSummary[] }
type Message = { Text: string; HTML: string }

export async function mailToken(request: APIRequestContext, email: string, subject: string, path: string) {
  const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'
  await expect.poll(async () => {
    const response = await request.get(`${mailpit}/api/v1/messages`)
    const body = await response.json() as MessageList
    return body.messages.some((message) => message.Subject.includes(subject) && message.To.some((to) => to.Address === email))
  }, { timeout: 15_000 }).toBe(true)

  const list = await (await request.get(`${mailpit}/api/v1/messages`)).json() as MessageList
  const summary = list.messages.find((message) => message.Subject.includes(subject) && message.To.some((to) => to.Address === email))!
  const message = await (await request.get(`${mailpit}/api/v1/message/${summary.ID}`)).json() as Message
  const match = `${message.Text}\n${message.HTML}`.match(new RegExp(`${path}\\?token=([^\\s<]+)`))
  if (!match) throw new Error(`${path} link was not found in Mailpit message`)
  return decodeURIComponent(match[1])
}

export async function registerAndLogin(page: Page, request: APIRequestContext, displayName: string) {
  const suffix = `${Date.now()}${test.info().workerIndex}${Math.floor(Math.random() * 10_000)}`
  const loginId = `dondok_${suffix}`.slice(0, 30)
  const email = `${loginId}@example.test`
  const password = 'Dondok-pass-2026!'

  await page.goto('/sign-up')
  await page.getByLabel('아이디').fill(loginId)
  await page.getByRole('button', { name: '중복 확인' }).click()
  await expect(page.getByRole('button', { name: '확인 완료' })).toBeVisible()
  await page.getByLabel('이름').fill(displayName)
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

  return { loginId, email, password }
}

export async function logoutFromLedger(page: Page) {
  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/login$/)
}
