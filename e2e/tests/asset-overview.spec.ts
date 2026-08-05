import { expect, test, type Locator, type Page } from '@playwright/test'
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
  ownershipScope: 'PERSONAL' | 'JOINT'
  ownerMemberId: string | null
  name: string
  openedOn: string
  memo: null
  openingBalanceWon: number
  currentBalanceWon: number
  currentMonthCardPaymentDueWon: number
  nextMonthCardPaymentDueWon: number
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
  const currentOwnerButton = page.getByRole('button', { name: /\(나\) 자산 보기$/ })
  await expect(currentOwnerButton).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('owner')).toBeNull()
  await expect(page.getByRole('region', { name: '자산 요약' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '자산 현황', exact: true })).toBeVisible()
  await expect(currentOwnerButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '자산 요약' })).toBeVisible()
})

test('자산 현황은 자금 signed 금액과 카드의 이번 달·다음 달 두 열 및 분명한 그룹 시작을 반응형으로 유지한다', async ({ page, request }) => {
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
    const currentOwnerButton = page.getByRole('button', { name: `${currentMember.displayName} (나) 자산 보기` })
    await expect(currentOwnerButton).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => new URL(page.url()).searchParams.get('owner')).toBeNull()
    await expectSummaryValues(page, { assets: '2,100,000원', liabilities: '950,000원', net: '1,150,000원', currentMonth: '0원', nextMonth: '0원' })

    await page.getByRole('button', { name: '전체 자산 보기' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('owner')).toBe('all')
    await expectOverviewMeaning(page, currentMember.displayName, otherMember.displayName, viewport)
    await expectOwnerSubmenu(page, currentMember.displayName, otherMember.displayName, viewport)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      `${viewport.label} ${viewport.width}px에서 페이지 가로 overflow가 없어야 합니다`,
    ).toBe(false)
  }

  await page.reload()
  await expect(page.getByRole('button', { name: '전체 자산 보기' })).toHaveAttribute('aria-pressed', 'true')
  await expectSummaryValues(page, { assets: '2,600,000원', liabilities: '1,300,000원', net: '1,300,000원', currentMonth: '400,000원', nextMonth: '270,000원' })

  await expectOwnerProjection(page, {
    buttonName: `${currentMember.displayName} (나) 자산 보기`,
    ownerKey: null,
    accessibleOwner: currentMember.displayName,
    summary: { assets: '2,100,000원', liabilities: '950,000원', net: '1,150,000원', currentMonth: '0원', nextMonth: '0원' },
    visibleAssets: ['계좌 2', '마이너스통장', '체크카드', '대출'],
    hiddenAssets: ['현금', '신용카드', CUSTOM_CARD_NAME, '투자'],
    visibleTypes: { 마이너스통장: '계좌' },
  })
  await expectOwnerProjection(page, {
    buttonName: `${otherMember.displayName} 자산 보기`,
    ownerKey: `member:${otherMember.memberId}`,
    accessibleOwner: otherMember.displayName,
    summary: { assets: '0원', liabilities: '0원', net: '0원', currentMonth: '0원', nextMonth: '0원' },
    visibleAssets: ['투자'],
    hiddenAssets: ['현금', '계좌 2', '마이너스통장', '신용카드', '체크카드', CUSTOM_CARD_NAME, '대출'],
  })
  await expectOwnerProjection(page, {
    buttonName: '공동 소유 자산 보기',
    ownerKey: 'joint',
    accessibleOwner: '공동 소유',
    summary: { assets: '500,000원', liabilities: '350,000원', net: '150,000원', currentMonth: '400,000원', nextMonth: '270,000원' },
    visibleAssets: ['현금', '신용카드', CUSTOM_CARD_NAME],
    hiddenAssets: ['계좌 2', '마이너스통장', '체크카드', '투자', '대출'],
    visibleTypes: { [CUSTOM_CARD_NAME]: '신용카드' },
  })

  await page.reload()
  await expect(page.getByRole('button', { name: '공동 소유 자산 보기' })).toHaveAttribute('aria-pressed', 'true')
  await expectSummaryValues(page, { assets: '500,000원', liabilities: '350,000원', net: '150,000원', currentMonth: '400,000원', nextMonth: '270,000원' })

  await page.goto('/assets?owner=member%3Amissing')
  await expect(page.getByRole('button', { name: `${currentMember.displayName} (나) 자산 보기` })).toHaveAttribute('aria-pressed', 'true')
  await expectSummaryValues(page, { assets: '2,100,000원', liabilities: '950,000원', net: '1,150,000원', currentMonth: '0원', nextMonth: '0원' })
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
  await expect(page.getByRole('region', { name: '자산 요약' })).toHaveCount(0)
  const emptyState = page.getByRole('status')
  await expect(emptyState).toContainText(`${emptyMember.displayName} 소유로 표시된 자산이 없어요.`)
  await expect(page.getByRole('heading', { name: '첫 자산을 등록해 보세요' })).toHaveCount(0)

  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  await emptyState.getByRole('button', { name: '전체 자산 보기' }).click()
  await expect(page.getByRole('region', { name: '자산 요약' })).toBeVisible()
  await expect(page.getByLabel('표시 중인 자산 수')).toContainText('전체 자산 8개')
})

async function expectOwnerSubmenu(page: Page, currentMemberName: string, otherMemberName: string, viewport: typeof RESPONSIVE_VIEWPORTS[number]) {
  const group = page.getByRole('group', { name: '소유자별 보기' })
  await expect(group).toBeVisible()
  await expect(group.getByRole('button', { name: '전체 자산 보기' })).toHaveAttribute('aria-pressed', 'true')
  const jointButton = group.getByRole('button', { name: '공동 소유 자산 보기' })
  const currentMemberButton = group.getByRole('button', { name: `${currentMemberName} (나) 자산 보기` })
  const otherMemberButton = group.getByRole('button', { name: `${otherMemberName} 자산 보기` })
  await expect(jointButton).toBeVisible()
  await expect(currentMemberButton).toBeVisible()
  await expect(otherMemberButton).toBeVisible()
  await expect(jointButton.locator('[data-joint-avatar]')).toHaveCount(1)
  await expect(currentMemberButton.locator('[data-member-avatar]')).toHaveAttribute('data-member-initial', Array.from(currentMemberName)[0])
  await expect(otherMemberButton.locator('[data-member-avatar]')).toHaveAttribute('data-member-initial', Array.from(otherMemberName)[0])
  await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1)

  await page.mouse.move(viewport.width - 1, viewport.height - 1)
  const selectedButton = group.getByRole('button', { name: '전체 자산 보기' })
  await expect(selectedButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const selectedStyle = await selectedButton.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderBottomColor: style.borderBottomColor,
      borderBottomWidth: Number.parseFloat(style.borderBottomWidth),
      borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
      borderRightWidth: Number.parseFloat(style.borderRightWidth),
      borderTopWidth: Number.parseFloat(style.borderTopWidth),
    }
  })
  expect(selectedStyle.borderBottomWidth, `${viewport.label} 선택 항목에는 하단선이 있어야 합니다`).toBeGreaterThanOrEqual(2)
  expect(selectedStyle.borderBottomColor, `${viewport.label} 선택 하단선은 투명하면 안 됩니다`).not.toBe('rgba(0, 0, 0, 0)')
  expect(selectedStyle.borderTopWidth, `${viewport.label} 소유자별 보기는 상자형 위 테두리를 쓰지 않아야 합니다`).toBe(0)
  expect(selectedStyle.borderLeftWidth, `${viewport.label} 소유자별 보기는 상자형 왼쪽 테두리를 쓰지 않아야 합니다`).toBe(0)
  expect(selectedStyle.borderRightWidth, `${viewport.label} 소유자별 보기는 상자형 오른쪽 테두리를 쓰지 않아야 합니다`).toBe(0)
  expect(selectedStyle.backgroundColor, `${viewport.label} 선택 항목은 별도 카드 배경을 쓰지 않아야 합니다`).toBe('rgba(0, 0, 0, 0)')

  for (const button of await group.getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box?.height ?? 0, `${viewport.label} 소유자별 보기 버튼은 44px 이상이어야 합니다`).toBeGreaterThanOrEqual(44)
  }
  if (viewport.width < 768) {
    const mobileMetrics = await group.evaluate((element) => {
      const buttons = [...element.querySelectorAll<HTMLElement>('button')]
      const labels = [...element.querySelectorAll<HTMLElement>('button > span[title]')]
      return {
        buttonTops: buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
        labels: labels.map((label) => {
          const style = getComputedStyle(label)
          return {
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          }
        }),
      }
    })
    expect(new Set(mobileMetrics.buttonTops).size, `${viewport.label} 소유자별 보기는 여러 줄로 화면을 밀어내면 안 됩니다`).toBe(1)
    for (const label of mobileMetrics.labels) {
      expect(label.whiteSpace, `${viewport.label} 소유자 이름은 한 버튼 안에서 쪼개지면 안 됩니다`).toBe('nowrap')
      expect(label.textOverflow, `${viewport.label} 소유자 이름을 말줄임표로 숨기면 안 됩니다`).not.toBe('ellipsis')
    }
  }
}

async function expectOwnerProjection(page: Page, projection: {
  buttonName: string
  ownerKey: string | null
  accessibleOwner: string
  summary: AssetSummaryExpectation
  visibleAssets: string[]
  hiddenAssets: string[]
  visibleTypes?: Record<string, string>
}) {
  await page.getByRole('button', { name: projection.buttonName }).click()
  await expect(page.getByRole('button', { name: projection.buttonName })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: '소유자별 보기' }).locator('[aria-pressed="true"]')).toHaveCount(1)
  await expect.poll(() => new URL(page.url()).searchParams.get('owner')).toBe(projection.ownerKey)
  await expectSummaryValues(page, projection.summary)

  for (const name of projection.visibleAssets) {
    const link = page.getByRole('link', { name: new RegExp(`^${escapeRegExp(name)},`) })
    await expect(link).toHaveCount(1)
    await expect(link.locator('[data-asset-owner]'), `${projection.buttonName}에서는 소유자 metadata를 반복하지 않아야 합니다`).toHaveCount(0)
    const visibleType = projection.visibleTypes?.[name]
    const identity = link.locator('[data-asset-identity]')
    if (visibleType) {
      await expect(link.locator('[data-asset-type]')).toHaveText(visibleType)
      await expect(identity).toHaveText(`${name} · ${visibleType}`)
    } else {
      await expect(link.locator('[data-asset-metadata]'), `${name} 기본 이름은 filtered 보기에서 metadata가 없어야 합니다`).toHaveCount(0)
      await expect(identity).toHaveText(name)
    }
    await expect(link, `${name}의 접근 가능한 이름에는 전체 소유자가 남아야 합니다`).toHaveAccessibleName(
      new RegExp(`^${escapeRegExp(name)}, [^,]+, ${escapeRegExp(projection.accessibleOwner)},`),
    )
  }
  for (const name of projection.hiddenAssets) {
    await expect(page.getByRole('link', { name: new RegExp(`^${escapeRegExp(name)},`) })).toHaveCount(0)
  }
  await expect(page.getByText(/활성\s*8\s*\/\s*50/)).toBeVisible()
}

type AssetSummaryExpectation = {
  assets: string
  liabilities: string
  net: string
  currentMonth: string
  nextMonth: string
}

async function expectSummaryValues(page: Page, expected: AssetSummaryExpectation) {
  const summary = page.getByRole('region', { name: '자산 요약' })
  await expectSummaryItem(summary, '총자산', expected.assets)
  await expectSummaryItem(summary, '총부채', expected.liabilities)
  await expectSummaryItem(summary, '순자산', expected.net)
  await expectSummaryItem(summary, '이번 달 카드 결제 금액', expected.currentMonth)
  await expectSummaryItem(summary, '다음 달 카드 결제 예정 금액', expected.nextMonth)
}

async function expectOverviewMeaning(page: Page, ownerName: string, otherOwnerName: string, viewport: typeof RESPONSIVE_VIEWPORTS[number]) {
  const viewportLabel = viewport.label
  const summary = page.getByRole('region', { name: '자산 요약' })
  await expect(summary, `${viewportLabel}에서 자산 요약이 보여야 합니다`).toBeVisible()
  await expectSummaryItem(summary, '총자산', '2,600,000원')
  await expectSummaryItem(summary, '총부채', '1,300,000원')
  await expectSummaryItem(summary, '순자산', '1,300,000원')
  await expectSummaryItem(summary, '이번 달 카드 결제 금액', '400,000원')
  await expectSummaryItem(summary, '다음 달 카드 결제 예정 금액', '270,000원')
  await expectSummaryHierarchy(summary, viewportLabel)

  const funds = page.getByRole('region', { name: /^자금·/ })
  const cards = page.getByRole('region', { name: '카드' })
  const investments = page.getByRole('region', { name: '투자' })
  const loans = page.getByRole('region', { name: '대출' })
  if (viewport.width < 768) {
    await page.evaluate(() => window.scrollTo(0, 0))
    const firstGroupTop = await funds.getByRole('heading').evaluate((element) => element.getBoundingClientRect().top)
    expect(firstGroupTop, `${viewportLabel} 첫 화면 안에서 첫 자산 그룹을 파악할 수 있어야 합니다`).toBeLessThan(viewport.height)
  }
  const liquidSummary = await expectGroupSummary(funds, { signed: '2,200,000원' })
  await expectGroupSummary(cards, { cardCurrent: '400,000원', cardNext: '270,000원' })
  const investmentSummary = await expectGroupSummary(investments, { zero: true })
  const loanSummary = await expectGroupSummary(loans, { liabilities: '600,000원' })
  await expect(funds.getByRole('listitem')).toHaveCount(3)
  await expect(cards.getByRole('listitem')).toHaveCount(3)
  await expect(investments.getByRole('listitem')).toHaveCount(1)
  await expect(loans.getByRole('listitem')).toHaveCount(1)
  await expectSingleColumnGroups([funds, cards, investments, loans], viewport)
  for (const emptyGroup of ['현금·계좌', '현금성', '계좌·저축', '보험']) {
    await expect(page.getByRole('heading', { name: emptyGroup, exact: true }), `${viewportLabel}에서 빈 ${emptyGroup} 그룹은 숨겨야 합니다`).toHaveCount(0)
  }

  const cashRow = await expectAssetRow(funds, '현금', { type: '현금', owner: '공동 소유', visibleOwner: '공동' }, { signed: '400,000원' }, viewport)
  const accountRow = await expectAssetRow(funds, '계좌 2', { type: '계좌', owner: ownerName, visibleOwner: '나' }, { signed: '2,100,000원' }, viewport)
  const overdraftRow = await expectAssetRow(funds, '마이너스통장', { type: '계좌', owner: ownerName, visibleType: '계좌', visibleOwner: '나' }, { signed: '-300,000원' }, viewport)
  await expectLiquidBalanceHierarchy(
    liquidSummary.assets[0],
    [...cashRow.assets, ...accountRow.assets, ...overdraftRow.assets],
    viewport,
  )
  const creditRow = await expectAssetRow(cards, '신용카드', { type: '신용카드', owner: '공동 소유', visibleOwner: '공동' }, { cardCurrent: '280,000원', cardNext: '190,000원' }, viewport)
  const debitRow = await expectAssetRow(cards, '체크카드', { type: '체크카드', owner: ownerName, visibleOwner: '나' }, { cardCurrent: '0원', cardNext: '0원' }, viewport)
  const positiveCardRow = await expectAssetRow(cards, CUSTOM_CARD_NAME, { type: '신용카드', owner: '공동 소유', visibleType: '신용카드', visibleOwner: '공동' }, { cardCurrent: '120,000원', cardNext: '80,000원' }, viewport)
  const investmentRow = await expectAssetRow(investments, '투자', { type: '투자', owner: otherOwnerName, visibleOwner: otherOwnerName }, { zero: true }, viewport)
  const loanRow = await expectAssetRow(loans, '대출', { type: '대출', owner: ownerName, visibleOwner: '나' }, { debt: '600,000원' }, viewport)
  await expectGroupMarkersBelowAssetRows([
    { group: funds, row: cashRow.row, assetName: '현금' },
    { group: cards, row: creditRow.row, assetName: '신용카드' },
    { group: investments, row: investmentRow.row, assetName: '투자' },
    { group: loans, row: loanRow.row, assetName: '대출' },
  ], viewport)
  await expect(funds).not.toContainText('부채')
  await expect(cards).not.toContainText('부채')
  await expect(creditRow.row).not.toContainText('-350,000원')
  await expect(debitRow.row).not.toContainText('-50,000원')
  await expect(positiveCardRow.row).not.toContainText('100,000원')
  await expectCardPaymentColumns(cards.locator('header'), viewport)
  await expectCardPaymentColumns(creditRow.row, viewport)
  await expectCardPaymentColumns(debitRow.row, viewport)
  await expectCardPaymentColumns(positiveCardRow.row, viewport)
  await expectCardPaymentHierarchy(
    cards.locator('header'),
    [creditRow.row, debitRow.row, positiveCardRow.row],
    viewport,
  )

  await expectMoneyRailLayout({
    debts: [
      ...loanSummary.debts,
      ...loanRow.debts,
    ],
    assets: [
      await expectLabeledAmount(summary, '총자산', '2,600,000원'),
      ...liquidSummary.assets,
      ...cashRow.assets,
      ...accountRow.assets,
      ...overdraftRow.assets,
    ],
    zeros: [...investmentSummary.zeros, ...investmentRow.zeros],
  }, viewport)
}

async function expectSummaryItem(summary: Locator, label: string, value: string) {
  const item = summary.locator('dl').filter({ hasText: label })
  await expect(item.getByRole('term').filter({ hasText: label })).toBeVisible()
  await expect(item.getByText(value, { exact: true })).toBeVisible()
}

async function expectSummaryHierarchy(summary: Locator, viewportLabel: string) {
  await expect(summary.locator('dl')).toHaveCount(5)
  await expect(summary.locator('dt')).toHaveText([
    '순자산 · 보관 자산 포함',
    '총부채',
    '총자산',
    '이번 달 카드 결제 금액',
    '다음 달 카드 결제 예정 금액',
  ])

  const values = Object.fromEntries(await Promise.all(['순자산', '총자산', '총부채'].map(async (label) => {
    const fontSize = await summary.locator('dl').filter({ hasText: label }).locator('dd').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    return [label, fontSize] as const
  })))
  expect(
    values['순자산'],
    `${viewportLabel}에서 순자산 값은 총자산·총부채보다 시각적으로 커야 합니다`,
  ).toBeGreaterThan(Math.max(values['총자산'], values['총부채']))
}

type RailLines = { debts: Locator[], assets: Locator[], zeros: Locator[] }

async function expectGroupSummary(group: Locator, expected: {
  assets?: string
  liabilities?: string
  signed?: string
  cardCurrent?: string
  cardNext?: string
  zero?: true
}): Promise<RailLines> {
  await expect(group).toBeVisible()
  const header = group.locator('header')
  const lines: RailLines = { debts: [], assets: [], zeros: [] }
  if (expected.assets) lines.assets.push(await expectLabeledAmount(header, '자산', expected.assets))
  if (expected.liabilities) lines.debts.push(await expectLabeledAmount(header, '부채', expected.liabilities))
  else await expect(header).not.toContainText('부채')
  if (expected.signed) lines.assets.push(await expectLabeledAmount(header, '현재 합계', expected.signed))
  if (expected.cardCurrent) await expectLabeledAmount(header, '이번 달 결제 금액', expected.cardCurrent)
  if (expected.cardNext) await expectLabeledAmount(header, '다음 달 결제 예정 금액', expected.cardNext)
  if (expected.zero) lines.zeros.push(await expectLabeledAmount(header, '잔액', '0원'))
  if (expected.assets && expected.liabilities) await expectDomOrder(header, '부채', '자산')
  if (expected.cardCurrent && expected.cardNext) await expectDomOrder(header, '이번 달 결제 금액', '다음 달 결제 예정 금액')
  return lines
}

async function expectSingleColumnGroups(groups: Locator[], viewport: typeof RESPONSIVE_VIEWPORTS[number]) {
  const rectangles = await Promise.all(groups.map((group) => group.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const header = element.querySelector('header')
    const list = element.querySelector('ul')
    if (!header || !list) throw new Error('자산 그룹 구조를 찾지 못했습니다.')
    const headerBox = header.getBoundingClientRect()
    const style = getComputedStyle(element)
    const headerStyle = getComputedStyle(header)
    const listStyle = getComputedStyle(list)
    return {
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      headerOffset: headerBox.top - box.top,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      borderTopWidth: Number.parseFloat(style.borderTopWidth),
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
      borderRightWidth: Number.parseFloat(style.borderRightWidth),
      borderRadius: Math.max(
        Number.parseFloat(style.borderTopLeftRadius),
        Number.parseFloat(style.borderTopRightRadius),
        Number.parseFloat(style.borderBottomRightRadius),
        Number.parseFloat(style.borderBottomLeftRadius),
      ),
      headerBorderBottomWidth: Number.parseFloat(headerStyle.borderBottomWidth),
      headerBorderBottomColor: headerStyle.borderBottomColor,
      listBorderBottomColor: listStyle.borderBottomColor,
    }
  })))
  const expectedGap = viewport.width >= 1280 ? 36 : viewport.width >= 768 ? 32 : 20
  const expectedHeaderOffset = viewport.width >= 768 ? 13 : 9
  for (const rectangle of rectangles) {
    expect(rectangle.borderTopWidth, `${viewport.label} 그룹 시작선은 1px이어야 합니다`).toBe(1)
    expect(rectangle.borderTopStyle, `${viewport.label} 그룹 시작선은 solid여야 합니다`).toBe('solid')
    expect(rectangle.borderTopColor, `${viewport.label} 그룹 시작선은 투명하면 안 됩니다`).not.toBe('rgba(0, 0, 0, 0)')
    expect(rectangle.borderTopColor, `${viewport.label} 그룹 시작선은 투명하면 안 됩니다`).not.toBe('transparent')
    expect(rectangle.headerOffset, `${viewport.label} 그룹 시작선과 header 사이 offset`).toBeGreaterThanOrEqual(8)
    expect(rectangle.headerOffset, `${viewport.label} 그룹 시작선과 header 사이 offset`).toBeLessThanOrEqual(13)
    expect(Math.abs(rectangle.headerOffset - expectedHeaderOffset), `${viewport.label} 그룹 top padding`).toBeLessThanOrEqual(1)
    expect(rectangle.backgroundColor, `${viewport.label} 그룹에 카드형 배경을 만들면 안 됩니다`).toBe('rgba(0, 0, 0, 0)')
    expect(rectangle.borderLeftWidth, `${viewport.label} 그룹에 왼쪽 테두리를 만들면 안 됩니다`).toBe(0)
    expect(rectangle.borderRightWidth, `${viewport.label} 그룹에 오른쪽 테두리를 만들면 안 됩니다`).toBe(0)
    expect(rectangle.borderRadius, `${viewport.label} 그룹에 둥근 모서리를 만들면 안 됩니다`).toBe(0)
    expect(rectangle.boxShadow, `${viewport.label} 그룹에 그림자를 만들면 안 됩니다`).toBe('none')
    expect(rectangle.headerBorderBottomWidth, `${viewport.label} 그룹 header 구분선은 유지해야 합니다`).toBe(1)
    expect(rectangle.headerBorderBottomColor, `${viewport.label} header와 row 구분선은 같은 subtle 토큰이어야 합니다`).toBe(rectangle.listBorderBottomColor)
    expect(rectangle.headerBorderBottomColor, `${viewport.label} 내부 구분선은 그룹 시작선보다 약한 별도 토큰이어야 합니다`).not.toBe(rectangle.borderTopColor)
  }
  for (let index = 1; index < rectangles.length; index += 1) {
    expect(
      rectangles[index].top,
      `${viewport.label}에서 자산 그룹은 한 열로 순차 배치되어야 합니다`,
    ).toBeGreaterThanOrEqual(rectangles[index - 1].bottom - 1)
    expect(
      Math.abs(rectangles[index].top - rectangles[index - 1].bottom - expectedGap),
      `${viewport.label}에서 서로 다른 자산 분류 사이에는 정확히 ${expectedGap}px 여백이 있어야 합니다`,
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(rectangles[index].width - rectangles[0].width),
      `${viewport.label}에서 모든 자산 그룹은 같은 한 열 너비를 써야 합니다`,
    ).toBeLessThanOrEqual(1)
  }
}

async function expectCardPaymentColumns(scope: Locator, viewport: typeof RESPONSIVE_VIEWPORTS[number]) {
  const rail = scope.locator('[data-money-rail="card-payment"]')
  await expect(rail).toHaveCount(1)
  await expect(rail.locator('dl')).toHaveCount(2)
  await expect(scope.locator('[data-money-supporting="card-payment"]')).toHaveCount(0)
  await expect(scope).not.toContainText('부채')
  await expectDomOrder(scope, '이번 달 결제 금액', '다음 달 결제 예정 금액')

  const [currentGeometry, nextGeometry] = await Promise.all([
    rail.locator('dl').nth(0),
    rail.locator('dl').nth(1),
  ].map((line) => line.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const value = element.querySelector('dd')
    return {
      top: box.top,
      bottom: box.bottom,
      right: box.right,
      valueFits: value ? getComputedStyle(value).whiteSpace === 'nowrap' && value.scrollWidth <= value.clientWidth + 1 : false,
    }
  })))
  expect(Math.abs(currentGeometry.top - nextGeometry.top), `${viewport.label} 카드 결제 금액 두 열은 같은 가로줄이어야 합니다`).toBeLessThanOrEqual(1)
  expect(currentGeometry.right, `${viewport.label} 이번 달 결제 금액은 다음 달보다 왼쪽 열이어야 합니다`).toBeLessThan(nextGeometry.right)
  expect(currentGeometry.valueFits && nextGeometry.valueFits, `${viewport.label} 카드 결제 금액은 줄바꿈되거나 넘치면 안 됩니다`).toBe(true)

  const placement = await rail.evaluate((element) => {
    const info = element.previousElementSibling
    if (!info) throw new Error('카드 자산 정보를 찾지 못했습니다.')
    const infoBox = info.getBoundingClientRect()
    const railBox = element.getBoundingClientRect()
    return { infoTop: infoBox.top, infoBottom: infoBox.bottom, railTop: railBox.top, railBottom: railBox.bottom }
  })
  if (viewport.width < 768) {
    expect(placement.railTop, `${viewport.label} 카드 결제 두 열은 자산 정보 아래에 있어야 합니다`).toBeGreaterThanOrEqual(placement.infoBottom - 1)
  } else {
    expect(
      placement.railTop < placement.infoBottom && placement.railBottom > placement.infoTop,
      `${viewport.label} 카드 결제 두 열은 자산 정보와 같은 행이어야 합니다`,
    ).toBe(true)
  }
}

async function expectGroupMarkersBelowAssetRows(
  pairs: Array<{ group: Locator, row: Locator, assetName: string }>,
  viewport: typeof RESPONSIVE_VIEWPORTS[number],
) {
  for (const { group, row, assetName } of pairs) {
    const groupMarker = group.getByRole('heading').first()
    const groupCount = groupMarker.locator('span').first()
    const assetNameText = row.getByTitle(assetName, { exact: true })
    const [markerStyle, countStyle, assetStyle] = await Promise.all([groupMarker, groupCount, assetNameText].map((locator) => locator.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        color: style.color,
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10),
        lineHeight: Number.parseFloat(style.lineHeight),
      }
    })))

    expect(markerStyle.fontSize, `${viewport.width}px 그룹명은 14px이어야 합니다`).toBe(14)
    expect(markerStyle.lineHeight, `${viewport.width}px 그룹명 line-height는 20px이어야 합니다`).toBe(20)
    expect(markerStyle.fontWeight, `${viewport.width}px 그룹명은 semibold여야 합니다`).toBeGreaterThanOrEqual(600)
    expect(markerStyle.color, `${viewport.width}px 그룹명은 body 색이어야 합니다`).toBe(assetStyle.color)
    expect(countStyle.fontSize, `${viewport.width}px 그룹 개수는 11px이어야 합니다`).toBe(11)
    expect(countStyle.lineHeight, `${viewport.width}px 그룹 개수 line-height는 16px이어야 합니다`).toBe(16)
    expect(countStyle.fontWeight, `${viewport.width}px 그룹 개수는 normal이어야 합니다`).toBe(400)
    expect(countStyle.color, `${viewport.width}px 그룹 개수는 muted 색이어야 합니다`).not.toBe(markerStyle.color)
    expect(
      markerStyle.fontSize,
      `${viewport.width}px에서 그룹 표지는 ${assetName} 자산명보다 크면 안 됩니다`,
    ).toBeLessThanOrEqual(assetStyle.fontSize)
    expect(
      markerStyle.fontSize < assetStyle.fontSize || markerStyle.fontWeight < assetStyle.fontWeight,
      `${viewport.width}px에서 그룹 표지는 ${assetName} 자산명보다 시각 위계가 낮아야 합니다`,
    ).toBe(true)
  }
}

async function expectLiquidBalanceHierarchy(
  groupTotal: Locator,
  assetBalances: Locator[],
  viewport: typeof RESPONSIVE_VIEWPORTS[number],
) {
  const groupFontSize = await groupTotal.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  expect(groupFontSize, `${viewport.label} 자금 현재 합계는 기존 16px 크기를 유지해야 합니다`).toBe(16)

  for (const assetBalance of assetBalances) {
    const assetFontSize = await assetBalance.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(assetFontSize, `${viewport.label} 개별 자금 현재 자산은 14px이어야 합니다`).toBe(14)
    expect(assetFontSize, `${viewport.label} 개별 자금 잔액은 그룹 현재 합계보다 작아야 합니다`).toBeLessThan(groupFontSize)
  }
}

async function expectCardPaymentHierarchy(
  groupHeader: Locator,
  assetRows: Locator[],
  viewport: typeof RESPONSIVE_VIEWPORTS[number],
) {
  const groupValues = groupHeader.locator('[data-money-rail="card-payment"] dd')
  await expect(groupValues).toHaveCount(2)
  const groupFontSizes = await groupValues.evaluateAll((elements) => (
    elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ))
  for (const groupFontSize of groupFontSizes) {
    expect(groupFontSize, `${viewport.label} 전체 카드의 월별 결제 합계는 16px이어야 합니다`).toBe(16)
  }

  for (const assetRow of assetRows) {
    const assetValues = assetRow.locator('[data-money-rail="card-payment"] dd')
    await expect(assetValues).toHaveCount(2)
    const assetFontSizes = await assetValues.evaluateAll((elements) => (
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    ))
    for (const assetFontSize of assetFontSizes) {
      expect(assetFontSize, `${viewport.label} 개별 카드의 월별 결제 금액은 14px이어야 합니다`).toBe(14)
      expect(assetFontSize, `${viewport.label} 개별 카드 금액은 전체 카드 합계보다 작아야 합니다`).toBeLessThan(groupFontSizes[0])
    }
  }
}

async function expectAssetRow(
  group: Locator,
  name: string,
  identity: {
    type: string
    owner: string
    visibleType?: string
    visibleOwner?: string
  },
  expected: {
    asset?: string
    debt?: string
    signed?: string
    cardCurrent?: string
    cardNext?: string
    zero?: true
  },
  viewport: typeof RESPONSIVE_VIEWPORTS[number],
): Promise<RailLines & { row: Locator }> {
  const link = group.getByRole('link', { name: new RegExp(`^${escapeRegExp(name)},`) })
  await expect(link, `${name} 자산 링크는 그룹 안에 한 번만 있어야 합니다`).toHaveCount(1)
  const row = link.locator('..')
  await expect(row).toBeVisible()
  await expect(row.getByText(name, { exact: true })).toBeVisible()
  await expect(link).toHaveAttribute('title', `${name} · ${identity.type} · ${identity.owner}`)

  const identityLine = link.locator('[data-asset-identity]')
  const nameNode = identityLine.locator('[data-asset-name]')
  const typeMetadata = identityLine.locator('[data-asset-type]')
  const ownerMetadata = identityLine.locator('[data-asset-owner]')
  await expect(identityLine).toHaveCount(1)
  await expect(nameNode).toHaveAttribute('title', name)
  if (identity.visibleType) await expect(typeMetadata).toHaveText(identity.visibleType)
  else await expect(typeMetadata, `${name} 기본 이름에는 종류를 반복하지 않아야 합니다`).toHaveCount(0)
  if (identity.visibleOwner) await expect(ownerMetadata).toHaveText(identity.visibleOwner)
  else await expect(ownerMetadata).toHaveCount(0)
  if (identity.visibleOwner) {
    if (identity.owner === '공동 소유') await expect(identityLine.locator('[data-joint-avatar]')).toHaveCount(1)
    else await expect(identityLine.locator('[data-member-avatar]')).toHaveAttribute('data-member-initial', Array.from(identity.owner)[0])
  } else {
    await expect(identityLine.locator('[data-member-avatar], [data-joint-avatar]')).toHaveCount(0)
  }

  const identityGeometry = await identityLine.evaluate((element) => {
    const link = element.closest('a')
    const nameNode = element.querySelector<HTMLElement>('[data-asset-name]')
    const metadata = element.querySelector<HTMLElement>('[data-asset-metadata]')
    if (!link || !nameNode) throw new Error('자산 identity 구조를 찾지 못했습니다.')
    const identityBox = element.getBoundingClientRect()
    const nameBox = nameNode.getBoundingClientRect()
    const metadataBox = metadata?.getBoundingClientRect()
    const identityStyle = getComputedStyle(element)
    const nameStyle = getComputedStyle(nameNode)
    const metadataStyle = metadata ? getComputedStyle(metadata) : null
    return {
      linkHeight: link.getBoundingClientRect().height,
      identityHeight: identityBox.height,
      identityWhiteSpace: identityStyle.whiteSpace,
      nameWhiteSpace: nameStyle.whiteSpace,
      nameOverflow: nameStyle.overflow,
      nameTextOverflow: nameStyle.textOverflow,
      linesOverlap: metadataBox
        ? nameBox.top < metadataBox.bottom && nameBox.bottom > metadataBox.top
        : true,
      metadataGap: metadataBox ? Math.max(0, metadataBox.left - nameBox.right) : 0,
      metadataWidth: metadataBox?.width ?? 0,
      identityWidth: identityBox.width,
      metadataWhiteSpace: metadataStyle?.whiteSpace ?? null,
      metadataOverflow: metadataStyle?.overflow ?? null,
      metadataTextOverflow: metadataStyle?.textOverflow ?? null,
    }
  })
  expect(identityGeometry.linkHeight, `${viewport.label} ${name} 링크는 터치할 수 있는 44px 높이를 유지해야 합니다`).toBeGreaterThanOrEqual(44)
  if (viewport.width < 768) {
    expect(identityGeometry.identityWhiteSpace, `${viewport.label} ${name} identity는 필요한 만큼 자연스럽게 줄바꿈해야 합니다`).toBe('normal')
    expect(identityGeometry.nameWhiteSpace, `${viewport.label} ${name} 자산명은 모바일에서 온전히 읽혀야 합니다`).toBe('normal')
    expect(identityGeometry.nameOverflow).not.toBe('hidden')
    expect(identityGeometry.nameTextOverflow).not.toBe('ellipsis')
    if (identity.visibleType || identity.visibleOwner) {
      expect(identityGeometry.metadataWhiteSpace, `${viewport.label} ${name} 부가정보도 모바일에서 온전히 읽혀야 합니다`).toBe('normal')
      expect(identityGeometry.metadataOverflow).not.toBe('hidden')
      expect(identityGeometry.metadataTextOverflow).not.toBe('ellipsis')
    }
  } else {
    expect(identityGeometry.identityWhiteSpace, `${viewport.label} ${name} identity는 한 줄이어야 합니다`).toBe('nowrap')
    expect(identityGeometry.identityHeight, `${viewport.label} ${name} identity가 두 줄 높이를 차지하면 안 됩니다`).toBeLessThanOrEqual(24)
    expect(identityGeometry.linesOverlap, `${viewport.label} ${name} metadata는 자산명과 같은 줄이어야 합니다`).toBe(true)
    expect(identityGeometry.metadataGap, `${viewport.label} ${name} metadata는 별도 열처럼 밀리지 않고 자산명 바로 뒤에 와야 합니다`).toBeLessThanOrEqual(1)
    expect(identityGeometry.nameWhiteSpace).toBe('nowrap')
    expect(identityGeometry.nameOverflow).toBe('hidden')
    expect(identityGeometry.nameTextOverflow).toBe('ellipsis')
    if (identity.visibleType || identity.visibleOwner) {
      expect(identityGeometry.metadataWidth, `${viewport.label} ${name} metadata는 자산명보다 우선하면 안 됩니다`).toBeLessThanOrEqual(identityGeometry.identityWidth * 0.45 + 1)
      expect(identityGeometry.metadataWhiteSpace).toBe('nowrap')
      expect(identityGeometry.metadataOverflow).toBe('hidden')
      expect(identityGeometry.metadataTextOverflow).toBe('ellipsis')
    }
  }
  const lines: RailLines & { row: Locator } = { row, debts: [], assets: [], zeros: [] }
  if (expected.debt) lines.debts.push(await expectLabeledAmount(row, '현재 부채', expected.debt))
  else await expect(row).not.toContainText('현재 부채')
  if (expected.asset) lines.assets.push(await expectLabeledAmount(row, '현재 자산', expected.asset))
  if (expected.signed) lines.assets.push(await expectLabeledAmount(row, '현재 자산', expected.signed))
  if (!expected.asset && !expected.signed) await expect(row).not.toContainText('현재 자산')
  if (expected.cardCurrent) await expectLabeledAmount(row, '이번 달 결제 금액', expected.cardCurrent)
  if (expected.cardNext) await expectLabeledAmount(row, '다음 달 결제 예정 금액', expected.cardNext)
  if (expected.zero) lines.zeros.push(await expectLabeledAmount(row, '잔액', '0원'))

  const accessibleParts = [name, identity.type, identity.owner]
  if (expected.debt) accessibleParts.push(`현재 부채 ${expected.debt}`)
  if (expected.asset) accessibleParts.push(`현재 자산 ${expected.asset}`)
  if (expected.signed) accessibleParts.push(`현재 자산 ${expected.signed}`)
  if (expected.cardCurrent) accessibleParts.push(`이번 달 결제 금액 ${expected.cardCurrent}`)
  if (expected.cardNext) accessibleParts.push(`다음 달 결제 예정 금액 ${expected.cardNext}`)
  if (expected.zero) accessibleParts.push('잔액 0원')
  await expect(link).toHaveAccessibleName(new RegExp(accessibleParts.map(escapeRegExp).join('.*')))
  if (expected.cardCurrent && expected.cardNext) await expectDomOrder(row, '이번 달 결제 금액', '다음 달 결제 예정 금액')
  return lines
}

async function expectLabeledAmount(scope: Locator, label: string, value: string): Promise<Locator> {
  const labelNode = scope.getByText(label, { exact: true })
  await expect(labelNode, `${label} label이 보여야 합니다`).toHaveCount(1)
  const line = labelNode.locator('..')
  const amount = line.getByText(value, { exact: true })
  await expect(amount, `${label}은 ${value}을 따로 보여야 합니다`).toBeVisible()
  return amount
}

async function expectDomOrder(scope: Locator, firstText: string, secondText: string) {
  const ordered = scope.getByText(firstText, { exact: true }).or(scope.getByText(secondText, { exact: true }))
  await expect(ordered).toHaveText([firstText, secondText])
}

async function expectMoneyRailLayout(lines: RailLines, viewport: typeof RESPONSIVE_VIEWPORTS[number]) {
  for (const line of [...lines.debts, ...lines.assets, ...lines.zeros]) {
    const metrics = await line.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        text: element.textContent?.trim() ?? '',
        whiteSpace: style.whiteSpace,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }
    })
    const fits = metrics.whiteSpace === 'nowrap' && metrics.scrollWidth <= metrics.clientWidth + 1
    expect(
      fits,
      `${viewport.width}px에서 ${metrics.text} money rail 금액이 줄바꿈되거나 넘치면 안 됩니다 (scroll ${metrics.scrollWidth}px / client ${metrics.clientWidth}px)`,
    ).toBe(true)
  }
  if (viewport.width < 390) return

  const debtBoxes = await Promise.all(lines.debts.map((line) => line.boundingBox()))
  const assetBoxes = await Promise.all(lines.assets.map((line) => line.boundingBox()))
  const zeroBoxes = await Promise.all(lines.zeros.map((line) => line.boundingBox()))
  if (debtBoxes.some((box) => !box) || assetBoxes.some((box) => !box) || zeroBoxes.some((box) => !box)) throw new Error('money rail geometry를 읽지 못했습니다.')
  const debts = debtBoxes as NonNullable<typeof debtBoxes[number]>[]
  const assets = assetBoxes as NonNullable<typeof assetBoxes[number]>[]
  const zeros = zeroBoxes as NonNullable<typeof zeroBoxes[number]>[]
  const debtRight = debts[0].x + debts[0].width
  const assetRight = assets[0].x + assets[0].width
  for (const box of debts) expect(Math.abs(box.x + box.width - debtRight), `${viewport.width}px 부채 rail right edge`).toBeLessThanOrEqual(2)
  for (const box of assets) expect(Math.abs(box.x + box.width - assetRight), `${viewport.width}px 자산 rail right edge`).toBeLessThanOrEqual(2)
  expect(debtRight, `${viewport.width}px에서 부채 rail은 자산 rail보다 안쪽이어야 합니다`).toBeLessThan(assetRight)
  for (const box of zeros) expect(Math.abs(box.x + box.width - assetRight), `${viewport.width}px 0원은 두 rail을 span해야 합니다`).toBeLessThanOrEqual(2)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function overviewAssets(currentMemberId: string, otherMemberId = currentMemberId): MockAsset[] {
  return [
    mockAsset({ id: 'cash', type: '현금', systemCode: 'CASH', behavior: 'STANDARD', balance: 400_000, ownershipScope: 'JOINT' }),
    mockAsset({ id: 'bank', type: '계좌', name: '계좌 2', systemCode: 'BANK', behavior: 'STANDARD', balance: 2_100_000, ownerMemberId: currentMemberId, paymentSourceCapable: true }),
    mockAsset({ id: 'overdraft', type: '계좌', name: '마이너스통장', systemCode: 'BANK', behavior: 'STANDARD', balance: -300_000, ownerMemberId: currentMemberId, paymentSourceCapable: true }),
    mockAsset({ id: 'credit', type: '신용카드', systemCode: 'CREDIT_CARD', behavior: 'CREDIT_CARD', balance: -350_000, ownershipScope: 'JOINT', cardCurrent: 280_000, cardNext: 190_000 }),
    mockAsset({ id: 'debit', type: '체크카드', systemCode: 'DEBIT_CARD', behavior: 'DEBIT_CARD', balance: -50_000, ownerMemberId: currentMemberId, cardCurrent: 0, cardNext: 0 }),
    mockAsset({ id: 'positive-credit', type: '신용카드', name: CUSTOM_CARD_NAME, systemCode: 'CREDIT_CARD', behavior: 'CREDIT_CARD', balance: 100_000, ownershipScope: 'JOINT', cardCurrent: 120_000, cardNext: 80_000 }),
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
  ownerMemberId?: string
  paymentSourceCapable?: boolean
  cardCurrent?: number
  cardNext?: number
}): MockAsset {
  return {
    assetId: `qc-${input.id}`,
    assetTypeId: `qc-type-${input.id}`,
    assetTypeName: input.type,
    systemCode: input.systemCode,
    behavior: input.behavior,
    paymentSourceCapable: input.paymentSourceCapable ?? false,
    ownershipScope: input.ownershipScope ?? 'PERSONAL',
    ownerMemberId: input.ownershipScope === 'JOINT' ? null : input.ownerMemberId ?? null,
    name: input.name ?? input.type,
    openedOn: '2026-07-01',
    memo: null,
    openingBalanceWon: input.balance,
    currentBalanceWon: input.balance,
    currentMonthCardPaymentDueWon: input.cardCurrent ?? 0,
    nextMonthCardPaymentDueWon: input.cardNext ?? 0,
    status: 'ACTIVE',
    archivedAt: null,
    version: 0,
    cardSettings: null,
    debitCardSettings: null,
    savingsSettings: null,
  }
}
