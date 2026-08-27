import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMoneyCalculatorState,
  formatWonInput,
  moneyCalculatorReducer,
  normalizeWonInput,
} from '../src/components/ui/moneyInput.ts'
import { requestMoneyKeypadHaptic } from '../src/components/ui/moneyKeypadHaptic.ts'

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

test('계산기는 현재 금액에서 사칙연산하고 원 단위 결과를 돌려준다', () => {
  let state = createMoneyCalculatorState('120000')
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'divide' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '3' })
  state = moneyCalculatorReducer(state, { type: 'equals' })
  assert.equal(state.value, '40000')
  assert.equal(state.error, null)

  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'multiply' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '3' })
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'subtract' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '20000' })
  state = moneyCalculatorReducer(state, { type: 'equals' })
  assert.equal(state.value, '100000')
})

test('새 피연산자 입력과 지우기·전체 초기화가 금액 draft를 예측 가능하게 바꾼다', () => {
  let state = createMoneyCalculatorState('1200')
  state = moneyCalculatorReducer(state, { type: 'backspace' })
  assert.equal(state.value, '120')

  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'add' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '00' })
  assert.equal(state.value, '120')
  assert.equal(state.entry, '0')

  state = moneyCalculatorReducer(state, { type: 'clear' })
  assert.deepEqual(state, createMoneyCalculatorState(''))
})

test('원 단위로 나누어떨어지지 않거나 0으로 나누는 계산은 기존 값을 보존한다', () => {
  let state = createMoneyCalculatorState('100')
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'divide' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '3' })
  state = moneyCalculatorReducer(state, { type: 'equals' })
  assert.equal(state.value, '100')
  assert.equal(state.error, '원 단위로 나누어떨어지는 계산만 할 수 있어요.')

  state = createMoneyCalculatorState('100')
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'divide' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '0' })
  state = moneyCalculatorReducer(state, { type: 'equals' })
  assert.equal(state.value, '100')
  assert.equal(state.error, '0으로 나눌 수 없어요.')
})

test('필드가 허용하지 않는 음수 결과와 안전한 정수 범위 초과를 거부한다', () => {
  let state = createMoneyCalculatorState('100')
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'subtract' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '200' })
  state = moneyCalculatorReducer(state, { type: 'equals' })
  assert.equal(state.error, '이 금액에는 음수 결과를 입력할 수 없어요.')

  state = createMoneyCalculatorState(String(Number.MAX_SAFE_INTEGER))
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'add' })
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '1' })
  state = moneyCalculatorReducer(state, { type: 'equals' }, true)
  assert.equal(state.error, '입력할 수 있는 금액 범위를 넘었어요.')
})

test('음수를 허용하는 자산 금액은 부호 전환과 음수 계산 결과를 지원한다', () => {
  let state = createMoneyCalculatorState('25000')
  state = moneyCalculatorReducer(state, { type: 'toggle-sign' }, true)
  assert.equal(state.value, '-25000')

  state = createMoneyCalculatorState('100')
  state = moneyCalculatorReducer(state, { type: 'operator', operator: 'subtract' }, true)
  state = moneyCalculatorReducer(state, { type: 'digits', digits: '200' }, true)
  state = moneyCalculatorReducer(state, { type: 'equals' }, true)
  assert.equal(state.value, '-100')
  assert.equal(state.error, null)
})

test('계산기 햅틱은 지원 기기에 짧게 요청하고 사용자 환경이 막으면 조용히 건너뛴다', () => {
  const patterns = []
  assert.equal(requestMoneyKeypadHaptic({
    vibrate(pattern) {
      patterns.push(pattern)
      return true
    },
  }), true)
  assert.deepEqual(patterns, [10])
  assert.equal(requestMoneyKeypadHaptic(undefined), false)
  assert.equal(requestMoneyKeypadHaptic({ vibrate: () => false }), false)
  assert.equal(requestMoneyKeypadHaptic({ vibrate: () => { throw new Error('blocked') } }), false)
})
