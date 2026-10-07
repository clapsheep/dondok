import { expect, test } from '@playwright/test'
import { registerAndLogin } from './support/auth'

test('자산 API는 공동 소유와 명의자 누락을 거부하고 기존 자산을 보존한다', async ({ page, request }, testInfo) => {
  await registerAndLogin(page, request, `명의자 검증 ${testInfo.workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  const results = await page.evaluate(async () => {
    const before = await (await fetch('/api/assets')).json() as Array<Record<string, unknown>>
    const asset = before.find((candidate) => candidate.systemCode === 'CASH')!
    const csrf = await (await fetch('/api/auth/csrf')).json() as { headerName: string; token: string }
    const responses: Array<{ method: string; status: number; requestId: string | null }> = []
    for (const method of ['POST', 'PUT']) {
      for (const owner of [{ ownershipScope: 'JOINT', ownerMemberId: null }, { ownershipScope: 'PERSONAL', ownerMemberId: null }]) {
        const response = await fetch(method === 'POST' ? '/api/assets' : `/api/assets/${asset.assetId}`, {
          method,
          headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token, 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ ...asset, ...owner, expectedVersion: asset.version, reassignTransactionsToNewOwner: false }),
        })
        responses.push({ method, status: response.status, requestId: response.headers.get('X-Request-Id') })
      }
    }
    const after = await (await fetch('/api/assets')).json()
    return { before, after, responses }
  })
  await testInfo.attach('owner-api-results', { body: Buffer.from(JSON.stringify(results)), contentType: 'application/json' })
  expect(results.responses.map((response) => response.status)).toEqual([400, 400, 400, 400])
  expect(results.after).toEqual(results.before)
})
