import assert from 'node:assert/strict'
import test from 'node:test'
import { formatWonInput, normalizeWonInput } from '../src/components/ui/moneyInput.ts'

test('원화 입력은 숫자를 천 단위로 구분해 표시한다', () => {
  assert.equal(formatWonInput('123456789'), '123,456,789')
  assert.equal(formatWonInput('-1250000'), '-1,250,000')
  assert.equal(formatWonInput(''), '')
})

test('표시용 콤마와 원 단위를 제거해 폼에는 정수 문자열만 전달한다', () => {
  assert.equal(normalizeWonInput('₩ 1,234,500원'), '1234500')
  assert.equal(normalizeWonInput('0001200'), '1200')
  assert.equal(normalizeWonInput(''), '')
})

test('음수는 허용된 자산 금액에서만 유지하고 소수 입력은 거부한다', () => {
  assert.equal(normalizeWonInput('-', true), '-')
  assert.equal(normalizeWonInput('-25,000,000', true), '-25000000')
  assert.equal(normalizeWonInput('-25000'), null)
  assert.equal(normalizeWonInput('1.5'), null)
})
