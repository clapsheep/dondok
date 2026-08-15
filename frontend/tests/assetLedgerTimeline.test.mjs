import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssetLedgerTimeline } from '../src/features/assets/assetLedgerTimeline.ts'

const asset = {
  assetId: 'account-1',
  openedOn: '2026-08-03',
  openingBalanceWon: 300_000,
  currentBalanceWon: 340_000,
}

function transaction(id, occurredOn, deltaWon, primaryAssetId = 'account-1') {
  return {
    transactionId: id,
    occurredOn,
    postings: deltaWon === null ? [{ assetId: 'linked-account', deltaWon: -10_000 }] : [{ assetId: 'account-1', deltaWon }],
    asset: { assetId: primaryAssetId },
  }
}

test('최신 잔액부터 역산해 각 거래 직후 잔액과 기준일 잔액을 한 시간축에 둔다', () => {
  const groups = buildAssetLedgerTimeline([
    transaction('income', '2026-08-05', 50_000),
    transaction('expense', '2026-08-03', -10_000),
    transaction('before-anchor', '2026-08-02', -20_000),
  ], asset, false)
  const entries = groups.flatMap((group) => group.items)

  assert.deepEqual(entries.map((entry) => entry.kind === 'TRANSACTION'
    ? [entry.transaction.transactionId, entry.balanceAfterWon]
    : ['opening', entry.balanceAfterWon]), [
    ['income', 340_000],
    ['expense', 290_000],
    ['opening', 300_000],
    ['before-anchor', 300_000],
  ])
})

test('연결 자산만 움직인 거래는 선택 자산의 거래 후 잔액을 바꾸지 않는다', () => {
  const groups = buildAssetLedgerTimeline([
    transaction('debit-card-use', '2026-08-05', null, 'debit-card'),
  ], { ...asset, assetId: 'debit-card', openingBalanceWon: 0, currentBalanceWon: 0 }, false)
  const transactionEntry = groups.flatMap((group) => group.items).find((entry) => entry.kind === 'TRANSACTION')

  assert.equal(transactionEntry.balanceAfterWon, 0)
})

test('아직 기준일까지 내려오지 않은 cursor 페이지에는 기준일 행을 성급하게 끼우지 않는다', () => {
  const groups = buildAssetLedgerTimeline([
    transaction('newer', '2026-08-05', 40_000),
  ], asset, true)

  assert.deepEqual(groups.flatMap((group) => group.items).map((entry) => entry.kind), ['TRANSACTION'])
})
