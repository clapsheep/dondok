import { expect, test, type Page } from '@playwright/test'
import { logoutFromLedger, registerAndLogin } from './support/auth'
import { openAssetPicker, selectAsset } from './support/asset-picker'

test('가계부 생성자가 초대한 구성원과 서로의 계좌를 함께 관리하고 이체한다', async ({ page, request }) => {
  const ownerName = `초대한 사람 ${test.info().workerIndex}`
  const memberName = `참여한 사람 ${test.info().workerIndex}`
  const owner = await registerAndLogin(page, request, ownerName)

  await expect(page.getByLabel('가계부 이름')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '초대 코드를 받으셨나요?' })).toBeVisible()
  await expect(page.getByRole('link', { name: '초대 코드 입력하기' })).toBeVisible()
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
  expect(invitationCode!.trim()).toMatch(/^\d{6}$/)
  await expect(page.getByText('초대가 준비됐어요')).toBeVisible()

  await logoutFromLedger(page)
  await registerAndLogin(page, request, memberName)
  await page.getByRole('link', { name: '초대 코드 입력하기' }).click()
  await page.getByLabel('6자리 초대 코드').fill(invitationCode!.trim())
  await page.getByRole('button', { name: '초대 확인하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부 초대' })).toBeVisible()
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '참여하기' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '가계부 초대' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '내 기록 보기' })).toBeChecked()
  await expect(page.getByRole('radio', { name: `${ownerName} 기록 보기` })).toBeVisible()
  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByText(ownerName, { exact: true })).toBeVisible()
  await expect(page.getByText(memberName, { exact: true })).toBeVisible()

  await page.goto(`/join?code=${encodeURIComponent(invitationCode!)}`)
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  await logoutFromLedger(page)
  await page.getByLabel('아이디').fill(owner.loginId)
  await page.getByLabel('비밀번호').fill(owner.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: `${memberName} 기록 보기` })).toBeVisible()
  await page.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '가계부 설정' })).toBeVisible()
  await expect(page.getByText(memberName, { exact: true })).toBeVisible()
  await expect(page.getByText('사용 완료', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '기록', exact: true }).click()
  const performerGroup = page.getByRole('radiogroup', { name: '누가 썼나요?' })
  await expect(performerGroup).toBeVisible()
  await expect(performerGroup.locator('[data-member-avatar]')).toHaveCount(2)
  await expect(page.getByRole('radio', { name: new RegExp(ownerName) })).toBeChecked()
  await page.getByRole('radio', { name: new RegExp(memberName) }).click()
  await expect(page.getByRole('radio', { name: new RegExp(memberName) })).toBeChecked()
  await page.getByRole('button', { name: '수입', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: '누가 받았나요?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: new RegExp(memberName) })).toBeChecked()

  const accounts = await createOtherMemberAccount(page, `${memberName} 계좌`)
  await page.goto('/transactions/new')
  await page.getByRole('button', { name: '이체', exact: true }).click()
  await expect(page.getByText('함께 쓰는 구성원의 계좌·적금과 공동 자산을 모두 선택할 수 있어요.')).toBeVisible()
  const sourceAccount = page.getByLabel('보내는 자산')
  const destinationAccount = page.getByLabel('받는 자산')
  const sourcePicker = await openAssetPicker(page, '보내는 자산')
  const showAllAssets = sourcePicker.picker.getByRole('switch', { name: '모든 자산 보기', exact: true })
  await expect(showAllAssets).not.toBeChecked()
  await expect(sourcePicker.picker.locator(`[data-asset-id="${accounts.source.assetId}"]`)).toBeVisible()
  await expect(sourcePicker.picker.locator(`[data-asset-id="${accounts.destination.assetId}"]`)).toHaveCount(0)
  const pickerViewport = page.viewportSize()
  await page.setViewportSize({ width: 320, height: 568 })
  await expect(sourcePicker.picker.getByRole('heading', { name: '보내는 자산 선택' })).toBeVisible()
  await expect(showAllAssets).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  if (pickerViewport) await page.setViewportSize(pickerViewport)
  await showAllAssets.click()
  await expect(showAllAssets).toBeChecked()
  await expect(sourcePicker.picker.locator(`[data-asset-id="${accounts.destination.assetId}"]`)).toBeVisible()
  await page.keyboard.press('Escape')

  const reopenedSourcePicker = await openAssetPicker(page, '보내는 자산')
  await expect(reopenedSourcePicker.picker.getByRole('switch', { name: '모든 자산 보기', exact: true })).not.toBeChecked()
  await expect(reopenedSourcePicker.picker.locator(`[data-asset-id="${accounts.destination.assetId}"]`)).toHaveCount(0)
  await page.keyboard.press('Escape')

  await selectAsset(page, '보내는 자산', accounts.source.name)
  await selectAsset(page, '받는 자산', accounts.destination.name)
  await expect(sourceAccount).toContainText('나')
  await expect(destinationAccount).toContainText(memberName)
  await page.getByLabel('금액').fill('210000')
  await page.getByLabel('내용 (선택)').fill('구성원 간 계좌 이체')
  await page.getByRole('button', { name: '기록 저장' }).click()
  await expect(page.getByRole('status')).toContainText('거래를 기록했어요')

  const balances = await accountBalances(page, [accounts.source.assetId, accounts.destination.assetId])
  expect(balances[accounts.source.assetId]).toBe(accounts.source.balanceWon - 210_000)
  expect(balances[accounts.destination.assetId]).toBe(accounts.destination.balanceWon + 210_000)

  const calendarSeed = await seedMemberCalendarIncome(page)
  await page.goto('/')
  const memberFilter = page.getByRole('radiogroup', { name: '표시할 구성원' })
  await expect(memberFilter.getByRole('radio', { name: '내 기록 보기' })).toBeChecked()
  await expect(page.getByTitle('수입 +100,000원')).toBeVisible()
  await expect(page.getByTitle('수입 +70,000원')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('member')).toBeNull()

  const monthTitle = page.locator('[data-month-title]')
  await expect(monthTitle).toBeVisible()
  expect(await monthTitle.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
    .toBeLessThanOrEqual(14)

  await memberFilter.getByRole('radio', { name: `${memberName} 기록 보기` }).locator('..').click()
  await expect(page.getByTitle('수입 +70,000원')).toBeVisible()
  await expect(page.getByTitle('수입 +100,000원')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('member')).toBe(calendarSeed.otherMemberId)

  await page.getByRole('gridcell', { name: /수입 \+70,000원/ }).getByRole('button').click()
  const dayDetail = page.getByRole('region', { name: `${calendarSeed.occurredOn} 거래 상세` })
  await expect(dayDetail.getByText('상대 달력 수입', { exact: true })).toBeVisible()
  await expect(dayDetail.getByText('내 달력 수입', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '달력으로 돌아가기' }).click()

  await page.getByRole('button', { name: '일별 보기' }).click()
  await expect(page.getByText('상대 달력 수입', { exact: true })).toBeVisible()
  await expect(page.getByText('내 달력 수입', { exact: true })).toHaveCount(0)

  await memberFilter.getByRole('radio', { name: '모든 구성원 기록 보기' }).locator('..').click()
  await expect(page.getByText('상대 달력 수입', { exact: true })).toBeVisible()
  await expect(page.getByText('내 달력 수입', { exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('member')).toBe('all')

  await memberFilter.getByRole('radio', { name: '내 기록 보기' }).locator('..').click()
  await expect(page.getByText('내 달력 수입', { exact: true })).toBeVisible()
  await expect(page.getByText('상대 달력 수입', { exact: true })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('member')).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})

type AccountSeed = { assetId: string; name: string; balanceWon: number }

async function createOtherMemberAccount(page: Page, name: string): Promise<{ source: AccountSeed; destination: AccountSeed }> {
  return page.evaluate(async (accountName) => {
    type Member = { memberId: string; currentUser: boolean }
    type Asset = { assetId: string; assetTypeId: string; systemCode: string; ownershipScope: 'PERSONAL' | 'JOINT'; ownerMemberId: string | null; name: string; currentBalanceWon: number }
    type AssetType = { assetTypeId: string; systemCode: string }
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const current = await requiredJson<{ ledger: { members: Member[] } }>('/api/ledger-books/current')
    const assets = await requiredJson<Asset[]>('/api/assets')
    const types = await requiredJson<AssetType[]>('/api/asset-types')
    const currentMember = current.ledger.members.find((member) => member.currentUser)
    const otherMember = current.ledger.members.find((member) => !member.currentUser)
    const source = assets.find((asset) => asset.systemCode === 'BANK' && asset.ownerMemberId === currentMember?.memberId)
    const bankType = types.find((type) => type.systemCode === 'BANK')
    if (!currentMember || !otherMember || !source || !bankType) throw new Error('cross-member transfer seed prerequisites were not found')

    const openedOn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    const response = await fetch('/api/assets', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        [csrf.headerName]: csrf.token,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        assetTypeId: bankType.assetTypeId,
        ownershipScope: 'PERSONAL',
        ownerMemberId: otherMember.memberId,
        name: accountName,
        openedOn,
        memo: null,
        openingBalanceWon: 0,
        cardSettings: null,
        debitCardSettings: null,
        savingsSettings: null,
      }),
    })
    if (!response.ok) throw new Error(`/api/assets returned ${response.status}: ${await response.text()}`)
    const destination = await response.json() as Asset
    return {
      source: { assetId: source.assetId, name: source.name, balanceWon: source.currentBalanceWon },
      destination: { assetId: destination.assetId, name: destination.name, balanceWon: destination.currentBalanceWon },
    }
  }, name)
}

async function accountBalances(page: Page, assetIds: string[]) {
  return page.evaluate(async (ids) => {
    const response = await fetch('/api/assets', { credentials: 'include' })
    if (!response.ok) throw new Error(`/api/assets returned ${response.status}`)
    const assets = await response.json() as Array<{ assetId: string; currentBalanceWon: number }>
    return Object.fromEntries(assets.filter((asset) => ids.includes(asset.assetId)).map((asset) => [asset.assetId, asset.currentBalanceWon]))
  }, assetIds)
}

async function seedMemberCalendarIncome(page: Page) {
  return page.evaluate(async () => {
    type Member = { memberId: string; currentUser: boolean }
    type Asset = { assetId: string; systemCode: string }
    type Category = { categoryId: string }
    const requiredJson = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { credentials: 'include' })
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json() as Promise<T>
    }
    const csrf = await requiredJson<{ headerName: string; token: string }>('/api/auth/csrf')
    const current = await requiredJson<{ ledger: { members: Member[] } }>('/api/ledger-books/current')
    const assets = await requiredJson<Asset[]>('/api/assets')
    const categories = await requiredJson<Category[]>('/api/categories?kind=INCOME')
    const currentMember = current.ledger.members.find((member) => member.currentUser)
    const otherMember = current.ledger.members.find((member) => !member.currentUser)
    const account = assets.find((asset) => asset.systemCode === 'BANK')
    const category = categories[0]
    if (!currentMember || !otherMember || !account || !category) {
      throw new Error('calendar member filter seed prerequisites were not found')
    }
    const occurredOn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    for (const input of [
      { amountWon: 100_000, performedByMemberId: currentMember.memberId, description: '내 달력 수입' },
      { amountWon: 70_000, performedByMemberId: otherMember.memberId, description: '상대 달력 수입' },
    ]) {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          [csrf.headerName]: csrf.token,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          type: 'INCOME',
          occurredOn,
          amountWon: input.amountWon,
          categoryId: category.categoryId,
          assetId: account.assetId,
          performedByMemberId: input.performedByMemberId,
          description: input.description,
          excludedFromStatistics: false,
        }),
      })
      if (!response.ok) throw new Error(`/api/transactions returned ${response.status}: ${await response.text()}`)
    }
    return { currentMemberId: currentMember.memberId, otherMemberId: otherMember.memberId, occurredOn }
  })
}
