import { expect, test, type Page } from '@playwright/test'
import { registerAndLogin } from './support/auth'

type LedgerMember = {
  memberId: string
  displayName: string
  currentUser: boolean
}

type MockAsset = {
  assetId: string
  assetTypeId: string
  assetTypeName: string
  systemCode: 'CASH' | 'BANK' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'INVESTMENT' | 'LOAN'
  behavior: 'STANDARD' | 'CREDIT_CARD' | 'DEBIT_CARD'
  paymentSourceCapable: boolean
  ownershipScope: 'PERSONAL'
  ownerMemberId: string
  financialInstitutionCode: 'OTHER' | 'KB_KOOKMIN' | 'TOSS_BANK' | null
  cardIssuerCode: 'OTHER' | 'SHINHAN' | null
  name: string
  openedOn: string
  memo: null
  openingBalanceWon: number
  currentBalanceWon: number
  currentMonthCardPaymentDueWon: number
  nextMonthCardPaymentDueWon: number
  nearestCardPaymentDueOn: string | null
  nearestCardPaymentDueWon: number
  followingCardPaymentDueOn: string | null
  followingCardPaymentDueWon: number
  status: 'ACTIVE' | 'ARCHIVED'
  archivedAt: string | null
  version: number
  cardSettings: null
  debitCardSettings: null
  savingsSettings: null
}

const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568, label: '소형 모바일' },
  { width: 390, height: 844, label: '모바일' },
  { width: 768, height: 1024, label: 'iPad' },
  { width: 1280, height: 900, label: '데스크톱' },
] as const

const CUSTOM_CARD_NAME = '신혼여행 준비금 환급을 모아 두는 아주 긴 카드 이름'
const OTHER_MEMBER_NAME = '함께 관리하는 이름이 매우 긴 다른 구성원'

test.use({ serviceWorkers: 'block' })

test('자산 현황 deep-link 직접 진입과 새로고침이 SPA 화면을 유지한다', async ({ page, request }) => {
  await registerAndLogin(page, request, `자산 deep-link ${test.info().workerIndex}`)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  await page.goto('/assets')
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: /^자금/ }).getByRole('listitem')).toHaveCount(2)
  await expect.poll(() => new URL(page.url()).searchParams.get('owner')).toBeNull()
  await expect(page.getByRole('region', { name: /^자금/ }).getByRole('listitem')).toHaveCount(2)

  await page.reload()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: /^자금/ }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('region', { name: /^자금/ }).getByRole('listitem')).toHaveCount(2)
})

test('자산 현황은 소유자별 합계와 카드 결제 예정 및 둥근 선택을 반응형으로 유지한다', async ({ page, request }, testInfo) => {
  const displayName = `자산 현황 사용자 ${test.info().workerIndex}`
  await registerAndLogin(page, request, displayName)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  const ledger = await page.evaluate(async () => {
    const response = await fetch('/api/ledger-books/current')
    if (!response.ok) throw new Error(`현재 가계부 조회 실패: ${response.status}`)
    const current = await response.json() as { ledger: { ledgerId: string, version: number, members: Array<LedgerMember & { joinedAt: string }> } }
    return current.ledger
  })
  const currentMember = ledger.members.find((candidate) => candidate.currentUser)
  if (!currentMember) throw new Error('현재 구성원을 찾지 못했습니다.')
  const otherMember = {
    memberId: '00000000-0000-0000-0000-000000000098',
    displayName: OTHER_MEMBER_NAME,
    currentUser: false,
    joinedAt: '2026-07-17T00:00:00Z',
  }
  await page.route('**/api/ledger-books/current', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ledger: { ...ledger, members: [...ledger.members, otherMember] } },
      })
      return
    }
    await route.continue()
  })
  const assets = overviewAssets(currentMember.memberId, otherMember.memberId)
  await page.route((url) => url.pathname === '/api/assets', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', json: assets })
      return
    }
    await route.continue()
  })

  await page.getByRole('link', { name: '자산', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()

  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/assets')
    await expect(page.getByRole('button', { name: `${currentMember.displayName} (나) 자산 보기` })).toHaveAttribute('aria-pressed', 'true')
    await expectSummary(page, ['1,150,000원', '2,100,000원', '950,000원'])
    await page.getByRole('button', { name: '전체 자산 보기' }).click()
    await expectSummary(page, ['1,300,000원', '2,600,000원', '1,300,000원'])
    const payments = page.getByRole('region', { name: '카드 결제 예정' })
    await expect(payments).toContainText('400,000원')
    await expect(payments).toContainText('270,000원')
    await expect(payments).toContainText('8월 25일')
    await expect(payments).toContainText('9월 25일')
    await expect(page.locator('a[href="/assets/qc-credit"][data-long-money]')).toContainText('-350,000원')
    await expect(page.locator('a[href="/assets/qc-positive-credit"][data-long-money]')).toContainText('100,000원')
    await expect(page.locator('a[href="/assets/qc-investment"][data-long-money]')).toContainText('0원')
    const selected = page.getByRole('button', { name: '전체 자산 보기' })
    expect(await selected.evaluate(element => Number.parseFloat(getComputedStyle(element).borderBottomWidth))).toBe(0)
    expect(await selected.evaluate(element => Number.parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(0)
    for (const group of await page.locator('.ui-asset-group').all()) {
      expect(await group.evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBe(0)
    }
    await page.getByRole('group', { name: '자산 종류' }).getByRole('button', { name: '카드', exact: true }).click()
    await expect(page.getByRole('region', { name: /^자금/ })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '전체 자산 보기' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('group', { name: '자산 종류' }).getByRole('button', { name: '카드', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    await page.getByRole('button', { name: `${otherMember.displayName} 자산 보기` }).click()
    await expectSummary(page, ['150,000원', '500,000원', '350,000원'])
    await expect(page.locator('a[href="/assets/qc-bank"][data-long-money]')).toHaveCount(0)
    await expect(page.locator('a[href="/assets/qc-cash"][data-long-money]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    if (viewport.width === 390 || viewport.width === 1280) await testInfo.attach(`asset-overview-${viewport.width}px`, {body:await page.screenshot({fullPage:true}),contentType:'image/png'})
  }
  await page.goto('/assets?owner=joint')
  await expect(page.getByRole('button', { name: `${currentMember.displayName} (나) 자산 보기` })).toHaveAttribute('aria-pressed', 'true')
})

test('자산이 없는 구성원 보기는 전체 onboarding과 구분하고 전체 보기로 복구한다', async ({ page, request }) => {
  const displayName = `빈 소유자 보기 ${test.info().workerIndex}`
  await registerAndLogin(page, request, displayName)
  await page.getByRole('button', { name: '가계부 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '가계부', exact: true })).toBeVisible()

  const ledger = await page.evaluate(async () => {
    const response = await fetch('/api/ledger-books/current')
    if (!response.ok) throw new Error(`현재 가계부 조회 실패: ${response.status}`)
    const current = await response.json() as { ledger: { ledgerId: string, version: number, members: Array<LedgerMember & { joinedAt: string }> } }
    return current.ledger
  })
  const currentMember = ledger.members.find((candidate) => candidate.currentUser)
  if (!currentMember) throw new Error('현재 구성원을 찾지 못했습니다.')
  const emptyMember = {
    memberId: '00000000-0000-0000-0000-000000000099',
    displayName: '아직 자산 없는 구성원',
    currentUser: false,
    joinedAt: '2026-07-16T00:00:00Z',
  }

  await page.route('**/api/ledger-books/current', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ledger: { ...ledger, members: [...ledger.members, emptyMember] } },
      })
      return
    }
    await route.continue()
  })
  await page.route((url) => url.pathname === '/api/assets', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', json: overviewAssets(currentMember.memberId) })
      return
    }
    await route.continue()
  })

  await page.goto('/assets')
  await page.getByRole('button', { name: `${emptyMember.displayName} 자산 보기` }).click()
  await expect(page.getByRole('group', { name: '소유자별 보기' })).toBeVisible()
  await expect(page.getByLabel('표시 중인 자산 수')).toContainText('0개')
  await expectSummary(page, ['0원', '0원', '0원'])
  const emptyState = page.getByRole('status')
  await expect(emptyState).toContainText(`${emptyMember.displayName} 소유로 표시된 자산이 없어요.`)
  await expect(page.getByRole('heading', { name: '첫 자산을 등록해 보세요' })).toHaveCount(0)

  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  await emptyState.getByRole('button', { name: '전체 자산 보기' }).click()
  await expect(page.getByRole('region', { name: '자산 요약' })).toBeVisible()
  await expect(page.getByLabel('표시 중인 자산 수')).toContainText('전체 소유 자산 8개')
})

async function expectSummary(page: Page, values: string[]) {
  const summary = page.getByRole('region', { name: '자산 요약' })
  await expect(summary.locator('.ui-total')).toHaveText(values[0])
  await expect(summary.locator('.ui-summary-details dd')).toHaveText(values.slice(1))
}

function overviewAssets(currentMemberId: string, otherMemberId = currentMemberId): MockAsset[] {
  return [
    mockAsset({ id: 'cash', type: '현금', systemCode: 'CASH', behavior: 'STANDARD', balance: 400_000, ownerMemberId: otherMemberId }),
    mockAsset({ id: 'bank', type: '계좌', name: '계좌 2', systemCode: 'BANK', behavior: 'STANDARD', balance: 2_100_000, ownerMemberId: currentMemberId, paymentSourceCapable: true, financialInstitutionCode: 'KB_KOOKMIN' }),
    mockAsset({ id: 'overdraft', type: '계좌', name: '마이너스통장', systemCode: 'BANK', behavior: 'STANDARD', balance: -300_000, ownerMemberId: currentMemberId, paymentSourceCapable: true, financialInstitutionCode: 'TOSS_BANK' }),
    mockAsset({ id: 'credit', type: '신용카드', systemCode: 'CREDIT_CARD', behavior: 'CREDIT_CARD', balance: -350_000, ownerMemberId: otherMemberId, cardCurrent: 280_000, cardNext: 190_000 }),
    mockAsset({ id: 'debit', type: '체크카드', systemCode: 'DEBIT_CARD', behavior: 'DEBIT_CARD', balance: -50_000, ownerMemberId: currentMemberId, cardCurrent: 0, cardNext: 0 }),
    mockAsset({ id: 'positive-credit', type: '신용카드', name: CUSTOM_CARD_NAME, systemCode: 'CREDIT_CARD', behavior: 'CREDIT_CARD', balance: 100_000, ownerMemberId: otherMemberId, cardCurrent: 120_000, cardNext: 80_000 }),
    mockAsset({ id: 'investment', type: '투자', systemCode: 'INVESTMENT', behavior: 'STANDARD', balance: 0, ownerMemberId: otherMemberId }),
    mockAsset({ id: 'loan', type: '대출', systemCode: 'LOAN', behavior: 'STANDARD', balance: -600_000, ownerMemberId: currentMemberId }),
  ]
}

function mockAsset(input: {
  id: string
  type: string
  name?: string
  systemCode: MockAsset['systemCode']
  behavior: MockAsset['behavior']
  balance: number
  ownershipScope?: MockAsset['ownershipScope']
  ownerMemberId: string
  paymentSourceCapable?: boolean
  cardCurrent?: number
  cardNext?: number
  financialInstitutionCode?: MockAsset['financialInstitutionCode']
  cardIssuerCode?: MockAsset['cardIssuerCode']
}): MockAsset {
  return {
    assetId: `qc-${input.id}`,
    assetTypeId: `qc-type-${input.id}`,
    assetTypeName: input.type,
    systemCode: input.systemCode,
    behavior: input.behavior,
    paymentSourceCapable: input.paymentSourceCapable ?? false,
    ownershipScope: input.ownershipScope ?? 'PERSONAL',
    ownerMemberId: input.ownerMemberId,
    financialInstitutionCode: input.financialInstitutionCode ?? null,
    cardIssuerCode: input.cardIssuerCode ?? null,
    name: input.name ?? input.type,
    openedOn: '2026-07-01',
    memo: null,
    openingBalanceWon: input.balance,
    currentBalanceWon: input.balance,
    currentMonthCardPaymentDueWon: input.cardCurrent ?? 0,
    nextMonthCardPaymentDueWon: input.cardNext ?? 0,
    nearestCardPaymentDueOn: input.behavior === 'CREDIT_CARD' ? '2099-08-25' : null,
    nearestCardPaymentDueWon: input.cardCurrent ?? 0,
    followingCardPaymentDueOn: input.behavior === 'CREDIT_CARD' ? '2099-09-25' : null,
    followingCardPaymentDueWon: input.cardNext ?? 0,
    status: 'ACTIVE',
    archivedAt: null,
    version: 0,
    cardSettings: null,
    debitCardSettings: null,
    savingsSettings: null,
  }
}
