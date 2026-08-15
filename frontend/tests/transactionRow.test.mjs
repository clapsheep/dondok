import assert from 'node:assert/strict'
import test from 'node:test'
import {
  transactionRowAmountPrefix,
  transactionRowAccessibleName,
  transactionRowDestination,
  transactionRowTone,
  transactionTypeLabel,
} from '../src/features/transactions/transactionRow.ts'

const purchase = {
  transactionId: 'purchase-1',
  type: 'EXPENSE',
  transferSubtype: null,
  managementType: 'CARD_PURCHASE',
  relatedPurchaseTransactionId: null,
}

test('카드 구매 행은 전용 원 구매 상세로 이동한다', () => {
  assert.equal(transactionRowDestination(purchase), '/transactions/purchase-1/card-purchase')
})

test('카드 환불 행은 수입이 아닌 환불로 표시하고 해당 환불 상세로 이동한다', () => {
  const refund = {
    ...purchase,
    transactionId: 'refund-1',
    managementType: 'CARD_REFUND',
    relatedPurchaseTransactionId: 'purchase-1',
  }

  assert.equal(transactionTypeLabel(refund), '환불')
  assert.equal(transactionRowAmountPrefix(refund), '+')
  assert.equal(transactionRowTone(refund), 'text-[var(--transfer)]')
  assert.equal(transactionRowDestination(refund), '/transactions/refund-1')
  assert.equal(
    transactionRowAccessibleName(refund, '식당 환불', '+40,000원'),
    '식당 환불 거래 상세, 환불 +40,000원',
  )
})

test('시스템 행도 읽기 전용 거래 상세로 이동한다', () => {
  assert.equal(transactionRowDestination({ ...purchase, managementType: 'SYSTEM' }), '/transactions/purchase-1')
})

test('수입·지출 행의 접근 가능한 이름에는 분류를 포함한다', () => {
  assert.equal(
    transactionRowAccessibleName({ ...purchase, category: { categoryId: 'food', name: '식비' } }, '점심', '-12,000원'),
    '점심 거래 상세, 지출 -12,000원, 분류 식비',
  )
})
