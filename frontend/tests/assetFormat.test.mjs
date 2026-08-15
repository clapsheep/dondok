import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPaymentDueDate } from '../src/features/assets/format.ts'

test('지난 결제일의 미결제 금액은 지난 달이어도 숨기지 않고 상태를 밝힌다', () => {
  assert.equal(formatPaymentDueDate('2026-08-10', '2026-08-15'), '미결제 · 8월 10일')
})

test('오늘 이후 결제일은 실제 월과 일을 그대로 보여준다', () => {
  assert.equal(formatPaymentDueDate('2026-09-05', '2026-08-15'), '9월 5일')
})
