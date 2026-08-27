export function normalizeWonInput(input: string, allowNegative = false): string | null {
  let compact = input.replaceAll(',', '').replaceAll(/\s/g, '').trim()
  if (compact.startsWith('₩')) compact = compact.slice(1)
  if (compact.endsWith('원')) compact = compact.slice(0, -1)
  if (compact === '') return ''

  const negative = compact.startsWith('-')
  if (negative && !allowNegative) return null
  const digits = negative ? compact.slice(1) : compact
  if (digits === '') return negative ? '-' : ''
  if (!/^\d+$/.test(digits)) return null

  const canonicalDigits = digits.replace(/^0+(?=\d)/, '')
  return `${negative ? '-' : ''}${canonicalDigits}`
}

export function formatWonInput(value: string): string {
  const compact = value.replaceAll(',', '').trim()
  if (compact === '' || compact === '-') return compact
  const negative = compact.startsWith('-')
  const digits = negative ? compact.slice(1) : compact
  if (!/^\d+$/.test(digits)) return value
  return `${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export type MoneyCalculatorOperator = 'add' | 'subtract' | 'multiply' | 'divide'

export type MoneyCalculatorAction =
  | { type: 'digits'; digits: string }
  | { type: 'operator'; operator: MoneyCalculatorOperator }
  | { type: 'equals' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'toggle-sign' }

export type MoneyCalculatorState = {
  value: string
  entry: string
  leftOperand: string | null
  operator: MoneyCalculatorOperator | null
  replaceEntry: boolean
  error: string | null
}

const maximumSafeWon = BigInt(Number.MAX_SAFE_INTEGER)

export function createMoneyCalculatorState(value: string): MoneyCalculatorState {
  return {
    value,
    entry: value,
    leftOperand: null,
    operator: null,
    replaceEntry: false,
    error: null,
  }
}

export function moneyCalculatorReducer(
  state: MoneyCalculatorState,
  action: MoneyCalculatorAction,
  allowNegative = false,
): MoneyCalculatorState {
  if (action.type === 'clear') return createMoneyCalculatorState('')

  if (action.type === 'digits') {
    const current = state.error ? createMoneyCalculatorState('') : state
    const nextEntry = appendDigits(current.replaceEntry ? '' : current.entry, action.digits)
    if (!isSafeWon(nextEntry)) return { ...current, error: '입력할 수 있는 금액 범위를 넘었어요.' }
    return {
      ...current,
      value: current.operator ? current.value : nextEntry,
      entry: nextEntry,
      replaceEntry: false,
      error: null,
    }
  }

  if (action.type === 'backspace') {
    if (state.error) return createMoneyCalculatorState(state.value)
    if (state.operator && state.replaceEntry) {
      return createMoneyCalculatorState(state.value)
    }
    const nextEntry = state.entry.slice(0, -1)
    return {
      ...state,
      value: state.operator ? state.value : nextEntry,
      entry: nextEntry,
      error: null,
    }
  }

  if (action.type === 'toggle-sign') {
    if (!allowNegative) return state
    const current = state.error ? createMoneyCalculatorState(state.value) : state
    const unsigned = current.entry.startsWith('-') ? current.entry.slice(1) : current.entry
    const nextEntry = current.entry.startsWith('-') ? unsigned : `-${unsigned || '0'}`
    return {
      ...current,
      value: current.operator ? current.value : nextEntry,
      entry: nextEntry,
      replaceEntry: false,
      error: null,
    }
  }

  if (action.type === 'operator') {
    const current = state.error ? createMoneyCalculatorState(state.value) : state
    if (!completeMoney(current.entry)) return current
    if (current.operator && current.leftOperand !== null && !current.replaceEntry) {
      const calculated = calculateWon(current.leftOperand, current.entry, current.operator, allowNegative)
      if (calculated.error) return { ...current, error: calculated.error }
      return {
        value: calculated.value,
        entry: calculated.value,
        leftOperand: calculated.value,
        operator: action.operator,
        replaceEntry: true,
        error: null,
      }
    }
    return {
      ...current,
      leftOperand: current.entry,
      operator: action.operator,
      replaceEntry: true,
      error: null,
    }
  }

  if (!state.operator || state.leftOperand === null || state.replaceEntry || !completeMoney(state.entry)) {
    return state.error ? createMoneyCalculatorState(state.value) : state
  }
  const calculated = calculateWon(state.leftOperand, state.entry, state.operator, allowNegative)
  if (calculated.error) return { ...state, error: calculated.error }
  return createMoneyCalculatorState(calculated.value)
}

export function moneyCalculatorExpression(state: MoneyCalculatorState) {
  const operator = state.operator ? operatorSymbol(state.operator) : ''
  if (!operator || state.leftOperand === null) return formatWonInput(state.entry || state.value || '0')
  const right = state.replaceEntry ? '' : ` ${formatWonInput(state.entry || '0')}`
  return `${formatWonInput(state.leftOperand)} ${operator}${right}`
}

function appendDigits(value: string, digits: string) {
  const negative = value.startsWith('-')
  const combined = `${negative ? value.slice(1) : value}${digits}`.replace(/^0+(?=\d)/, '') || '0'
  return `${negative ? '-' : ''}${combined}`
}

function completeMoney(value: string) {
  return /^-?\d+$/.test(value)
}

function isSafeWon(value: string) {
  return completeMoney(value) && abs(BigInt(value)) <= maximumSafeWon
}

function calculateWon(
  leftValue: string,
  rightValue: string,
  operator: MoneyCalculatorOperator,
  allowNegative: boolean,
): { value: string; error: null } | { value: ''; error: string } {
  const left = BigInt(leftValue)
  const right = BigInt(rightValue)
  if (operator === 'divide' && right === 0n) return { value: '', error: '0으로 나눌 수 없어요.' }
  if (operator === 'divide' && left % right !== 0n) {
    return { value: '', error: '원 단위로 나누어떨어지는 계산만 할 수 있어요.' }
  }

  const result = operator === 'add'
    ? left + right
    : operator === 'subtract'
      ? left - right
      : operator === 'multiply'
        ? left * right
        : left / right
  if (!allowNegative && result < 0n) return { value: '', error: '이 금액에는 음수 결과를 입력할 수 없어요.' }
  if (abs(result) > maximumSafeWon) return { value: '', error: '입력할 수 있는 금액 범위를 넘었어요.' }
  return { value: result.toString(), error: null }
}

function operatorSymbol(operator: MoneyCalculatorOperator) {
  if (operator === 'add') return '+'
  if (operator === 'subtract') return '−'
  if (operator === 'multiply') return '×'
  return '÷'
}

function abs(value: bigint) {
  return value < 0n ? -value : value
}
