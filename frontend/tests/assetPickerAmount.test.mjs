import assert from 'node:assert/strict'
import test from 'node:test'
import { assetPickerAmountLabel } from '../src/features/assets/assetPickerAmount.ts'

function asset(overrides = {}) {
  return {
    behavior: 'STANDARD',
    currentBalanceWon: 350_000,
    nearestCardPaymentDueWon: 0,
    ...overrides,
  }
}

test('카드는 가장 가까운 결제 예정액을 보여준다', () => {
  assert.equal(assetPickerAmountLabel(asset({
    behavior: 'CREDIT_CARD',
    nearestCardPaymentDueWon: 210_000,
  })), '결제 예정 210,000원')
})

test('카드의 가장 가까운 결제 예정액이 바뀌면 그대로 반영한다', () => {
  assert.equal(assetPickerAmountLabel(asset({
    behavior: 'CREDIT_CARD',
    nearestCardPaymentDueWon: 85_000,
  })), '결제 예정 85,000원')
})

test('카드가 아닌 자산은 현재 잔액을 보여준다', () => {
  assert.equal(assetPickerAmountLabel(asset()), '잔액 350,000원')
})
