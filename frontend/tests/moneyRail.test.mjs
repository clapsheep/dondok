import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldStackMoneyRail } from '../src/features/assets/moneyRail.ts'

test('일반적인 원화 금액은 두 money rail을 유지한다', () => {
  assert.equal(shouldStackMoneyRail(['2,600,000원', '1,000,000원', '400,000원']), false)
})

test('rail 폭을 넘길 수 있는 긴 금액은 해당 rail만 한 열로 전환한다', () => {
  assert.equal(shouldStackMoneyRail(['9,007,199,254,740,991원']), true)
})
