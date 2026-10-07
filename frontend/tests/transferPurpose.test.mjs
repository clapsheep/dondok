import assert from 'node:assert/strict'
import test from 'node:test'
import { suggestedTransferPurpose } from '../src/features/transactions/transferPurpose.ts'
import { transactionTypeLabel } from '../src/features/transactions/transactionRow.ts'

test('신규 자금의 납입과 인출을 제안하되 재배치는 일반 이체로 둔다', () => {
  assert.equal(suggestedTransferPurpose('BANK', 'SAVINGS'), 'SAVINGS_DEPOSIT')
  assert.equal(suggestedTransferPurpose('BANK', 'INVESTMENT'), 'INVESTMENT_DEPOSIT')
  assert.equal(suggestedTransferPurpose('SAVINGS', 'BANK'), 'SAVINGS_WITHDRAWAL')
  assert.equal(suggestedTransferPurpose('INVESTMENT', 'BANK'), 'INVESTMENT_WITHDRAWAL')
  for (const source of ['SAVINGS', 'INVESTMENT']) {
    for (const destination of ['SAVINGS', 'INVESTMENT']) assert.equal(suggestedTransferPurpose(source, destination), 'GENERAL')
  }
  assert.equal(suggestedTransferPurpose('BANK', 'BANK'), 'GENERAL')
  assert.equal(suggestedTransferPurpose(), 'GENERAL')
})

test('저장된 목적을 원장에 표시하며 시스템 카드 결제 명칭은 유지한다', () => {
  assert.equal(transactionTypeLabel({ type: 'TRANSFER', transferPurpose: 'SAVINGS_DEPOSIT', transferSubtype: 'NORMAL' }), '적금 납입')
  assert.equal(transactionTypeLabel({ type: 'TRANSFER', transferPurpose: 'GENERAL', transferSubtype: 'NORMAL' }), '이체')
  assert.equal(transactionTypeLabel({ type: 'TRANSFER', transferPurpose: null, transferSubtype: 'CARD_SETTLEMENT' }), '카드 정산')
})
