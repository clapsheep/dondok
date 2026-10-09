import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssetOverview, buildAssetStatusOverview } from '../src/features/assets/overview.ts'

function asset(systemCode, currentBalanceWon, nearestCardPaymentDueWon = 0, followingCardPaymentDueWon = 0) {
  return { systemCode, currentBalanceWon, nearestCardPaymentDueWon, followingCardPaymentDueWon }
}

test('전체 자산과 부채는 종류가 아니라 잔액 부호로 합산한다', () => {
  const overview = buildAssetOverview([
    asset('CASH', 120_000),
    asset('BANK', -20_000),
    asset('LOAN', 30_000),
    asset('INSURANCE', 0),
  ])

  assert.equal(overview.assetsWon, 150_000)
  assert.equal(overview.liabilitiesWon, 20_000)
  assert.equal(overview.netWon, 130_000)
})

test('고정 시스템 코드 순서로 그룹화하고 빈 그룹은 제외한다', () => {
  const overview = buildAssetOverview([
    asset('CASH', 1_000),
    asset('OTHER', 10_000),
    asset('BANK', 3_000),
    asset('SAVINGS', 50_000),
    asset('BANK', -5_000),
    asset('CREDIT_CARD', -40_000, 35_000, 25_000),
    asset('DEBIT_CARD', 0),
    asset('INVESTMENT', 70_000),
    asset('LOAN', -100_000),
    asset('INSURANCE', 20_000),
  ])

  assert.deepEqual(overview.groups.map((group) => group.key), ['liquid', 'cards', 'savings', 'investments', 'loans', 'insurance'])
  assert.deepEqual(overview.groups.map((group) => group.label), ['자금', '카드', '적금', '투자', '대출', '보험'])
  assert.deepEqual(overview.groups.map((group) => group.items.map((item) => item.systemCode)), [
    ['CASH', 'OTHER', 'BANK', 'BANK'],
    ['CREDIT_CARD', 'DEBIT_CARD'],
    ['SAVINGS'],
    ['INVESTMENT'],
    ['LOAN'],
    ['INSURANCE'],
  ])
  assert.equal(overview.groups[0].assetsWon, 14_000)
  assert.equal(overview.groups[0].liabilitiesWon, 5_000)
  assert.equal(overview.groups[0].netWon, 9_000)
  assert.equal(overview.groups.find(group => group.key === 'savings').netWon, 50_000)
  assert.equal(overview.groups.find(group => group.key === 'investments').netWon, 70_000)
  assert.equal(overview.groups.reduce((sum, group) => sum + group.netWon, 0), overview.netWon)
  assert.equal(overview.groups[1].nearestCardPaymentDueWon, 35_000)
  assert.equal(overview.groups[1].followingCardPaymentDueWon, 25_000)
})

test('카드별 가장 가까운 결제와 그다음 결제 금액은 각각 선형 합산한다', () => {
  const overview = buildAssetOverview([
    asset('CREDIT_CARD', -50_000, 30_000, 45_000),
    asset('CREDIT_CARD', -20_000, 12_000, 8_000),
    asset('DEBIT_CARD', 0, 0),
  ])

  assert.equal(overview.nearestCardPaymentDueWon, 42_000)
  assert.equal(overview.followingCardPaymentDueWon, 53_000)
})

test('자산은 기관과 무관하게 고정 종류 순서와 이름으로 정렬한다', () => {
  const overview = buildAssetOverview([
    { ...asset('BANK', 1), assetId: '3', assetTypeName: '계좌', name: '토스 통장', financialInstitutionCode: 'TOSS_BANK' },
    { ...asset('SAVINGS', 1), assetId: '2', assetTypeName: '적금', name: '국민 적금', financialInstitutionCode: 'KB_KOOKMIN' },
    { ...asset('CASH', 1), assetId: '1', assetTypeName: '현금', name: '현금', financialInstitutionCode: null },
    { ...asset('BANK', 1), assetId: '4', assetTypeName: '계좌', name: '국민 통장', financialInstitutionCode: 'KB_KOOKMIN' },
  ])

  assert.deepEqual(overview.groups[0].items.map((item) => item.name), ['현금', '국민 통장', '토스 통장'])
})

test('상단 합계에는 사용 종료 자산을 포함하고 활성 그룹에서는 제외한다', () => {
  const active = { ...asset('BANK', 100_000), status: 'ACTIVE' }
  const archived = { ...asset('SAVINGS', 50_000), status: 'ARCHIVED' }
  const overview = buildAssetStatusOverview([active, archived])

  assert.equal(overview.summary.netWon, 150_000)
  assert.equal(overview.active.netWon, 100_000)
  assert.deepEqual(overview.activeAssets, [active])
  assert.deepEqual(overview.archivedAssets, [archived])
})
