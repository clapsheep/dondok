import { expect, test, type APIRequestContext } from '@playwright/test'
import { registerAndLogin } from './support/auth'
import { openAssetPicker, selectAsset } from './support/asset-picker'

async function command(request: APIRequestContext, path: string, data?: unknown) {
  const csrf = await (await request.get('/api/auth/csrf')).json()
  return request.post(path, { data, headers: { [csrf.headerName]: csrf.token, 'Idempotency-Key': crypto.randomUUID() } })
}

test('same-owner transfer choices preserve independent performer and creator @pr', async ({ page, request, browser }, testInfo) => {
  await registerAndLogin(page, request, '작성 구성원')
  expect((await command(page.request, '/api/ledger-books')).ok()).toBeTruthy()
  const invitation = await (await command(page.request, '/api/ledger-books/current/invitations')).json()
  const partnerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5173' })
  try {
    const partner = await partnerContext.newPage()
    await registerAndLogin(partner, request, '사용 구성원')
    expect((await command(partner.request, '/api/ledger-invitations/redemptions', { code: invitation.code })).ok()).toBeTruthy()
    const { ledger } = await (await page.request.get('/api/ledger-books/current')).json()
    const me = ledger.members.find((member: { currentUser: boolean }) => member.currentUser)
    const other = ledger.members.find((member: { currentUser: boolean }) => !member.currentUser)
    const types = await (await page.request.get('/api/asset-types')).json()
    const bankType = types.find((type: { systemCode: string }) => type.systemCode === 'BANK')
    const makeBank = async (name: string, ownerMemberId: string) => {
      const response = await command(page.request, '/api/assets', {
        assetTypeId: bankType.assetTypeId, ownershipScope: 'PERSONAL', ownerMemberId, name,
        openedOn: '2026-01-01', openingBalanceWon: 10000, memo: null, cardSettings: null,
      })
      expect(response.ok()).toBeTruthy()
      return response.json()
    }
    const source = await makeBank('출발 계좌', me.memberId)
    const destination = await makeBank('같은 명의 계좌', me.memberId)
    const foreign = await makeBank('다른 명의 계좌', other.memberId)
    const transfer = { type: 'TRANSFER', occurredOn: '2026-10-09', amountWon: 1000,
      sourceAssetId: source.assetId, destinationAssetId: foreign.assetId, performedByMemberId: other.memberId,
      description: '독립 거래 검증', transferPurpose: 'GENERAL' }
    const rejected = await command(page.request, '/api/transactions', transfer)
    expect(rejected.status()).toBe(400)
    expect((await rejected.json()).errorCode).toBe('CROSS_MEMBER_ASSET_CONNECTION_NOT_ALLOWED')
    const accepted = await command(page.request, '/api/transactions', { ...transfer, destinationAssetId: destination.assetId })
    expect(accepted.ok()).toBeTruthy()
    const transaction = await accepted.json()
    expect(transaction.performedBy.memberId).toBe(other.memberId)
    expect(transaction.createdBy.memberId).toBe(me.memberId)
    await testInfo.attach('independent-money-seed', { body: JSON.stringify({ ledgerId: ledger.ledgerId, source: source.assetId, destination: destination.assetId, foreign: foreign.assetId, transactionId: transaction.transactionId, requestId: accepted.headers()['x-request-id'] }), contentType: 'application/json' })
    await page.goto('/transactions/new')
    await page.getByRole('button', { name: '이체', exact: true }).click()
    await page.locator('summary').filter({ hasText: '옮긴 사람' }).click()
    await expect(page.getByRole('radio', { name: /사용 구성원/ })).toBeVisible()
    await page.locator('summary').filter({ hasText: '옮긴 사람' }).click()
    if (!await page.getByRole('button', { name: '보내는 자산', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '다음', exact: true }).click()
    }
    await selectAsset(page, '보내는 자산', source.name)
    const { picker } = await openAssetPicker(page, '받는 자산')
    await expect(picker.getByRole('button', { name: /^같은 명의 계좌,/ })).toBeVisible()
    await expect(picker.getByRole('button', { name: /^다른 명의 계좌,/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
  } finally { await partnerContext.close() }
})
