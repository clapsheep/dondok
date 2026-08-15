import assert from 'node:assert/strict'
import test from 'node:test'
import { assetPickerAmountLabel } from '../src/features/assets/assetPickerAmount.ts'

function asset(overrides = {}) {
  return {
    behavior: 'STANDARD',
    currentBalanceWon: 350_000,
    currentMonthCardPaymentDueWon: 0,
    nextMonthCardPaymentDueWon: 0,
    ...overrides,
  }
}

test('이번 달 카드 결제액이 없으면 다음 달의 가장 가까운 결제 예정액을 보여준다', () => {
  assert.equal(assetPickerAmountLabel(asset({
    behavior: 'CREDIT_CARD',
    currentMonthCardPaymentDueWon: 0,
    nextMonthCardPaymentDueWon: 210_000,
  })), '결제 예정 210,000원')
})

test('이번 달 미결제 금액이 있으면 다음 달보다 먼저 보여준다', () => {
  assert.equal(assetPickerAmountLabel(asset({
    behavior: 'CREDIT_CARD',
    currentMonthCardPaymentDueWon: 85_000,
    nextMonthCardPaymentDueWon: 210_000,
  })), '결제 예정 85,000원')
})

test('카드가 아닌 자산은 현재 잔액을 보여준다', () => {
  assert.equal(assetPickerAmountLabel(asset()), '잔액 350,000원')
})
