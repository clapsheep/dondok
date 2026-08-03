import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cardPaymentScheduleStatusLabel,
  cardStatementPaymentTypeLabel,
  cardStatementStatusLabel,
  sortCardStatementsForDisplay,
} from '../src/features/card-statements/presentation.ts'

test('명세·자동 정산·결제 타입을 사용자 문구로 표시한다', () => {
  assert.equal(cardStatementStatusLabel('FINALIZED'), '결제 금액 확정')
  assert.equal(cardPaymentScheduleStatusLabel('FAILED'), '자동 정산 재시도 대기')
  assert.equal(cardStatementPaymentTypeLabel('PREPAYMENT'), '선결제')
  assert.equal(cardStatementPaymentTypeLabel('REGULAR'), '정기 결제')
})

test('가장 가까운 미결제 명세를 완료 명세보다 먼저 표시한다', () => {
  const base = {
    cardAsset: { assetId: 'card-1', name: '생활비 카드' },
    grossAmountWon: 100_000,
    paidAmountWon: 0,
    remainingAmountWon: 100_000,
    version: 1,
    automaticSettlement: null,
  }
  const ordered = sortCardStatementsForDisplay([
    { ...base, statementId: 'paid', dueOn: '2026-07-25', status: 'PAID' },
    { ...base, statementId: 'later', dueOn: '2026-09-25', status: 'OPEN' },
    { ...base, statementId: 'closest', dueOn: '2026-08-25', status: 'FINALIZED' },
  ])

  assert.deepEqual(ordered.map((statement) => statement.statementId), ['closest', 'later', 'paid'])
})
