import { Delete } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import {
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from './Popover'
import {
  moneyCalculatorExpression,
  type MoneyCalculatorAction,
  type MoneyCalculatorOperator,
  type MoneyCalculatorState,
} from './moneyInput'
import { requestMoneyKeypadHaptic } from './moneyKeypadHaptic'

type Props = {
  id: string
  label: string
  state: MoneyCalculatorState
  allowNegative: boolean
  onAction: (action: MoneyCalculatorAction) => void
}

const operators: Array<{ operator: MoneyCalculatorOperator; label: string; symbol: string }> = [
  { operator: 'divide', label: '나누기', symbol: '÷' },
  { operator: 'multiply', label: '곱하기', symbol: '×' },
  { operator: 'subtract', label: '빼기', symbol: '−' },
  { operator: 'add', label: '더하기', symbol: '+' },
]

export function MoneyCalculatorKeypad({ id, label, state, allowNegative, onAction }: Props) {
  const titleId = `${id}-calculator-title`
  const descriptionId = `${id}-calculator-description`
  const expression = moneyCalculatorExpression(state)

  return (
    <PopoverContent
      className="max-h-[calc(100dvh-.5rem)] md:w-[21rem]"
      positionerClassName="money-calculator-positioner"
      backdropClassName="pointer-events-none bg-transparent md:bg-transparent"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      initialFocus={false}
    >
      <PopoverHeader className="shrink-0  px-4 py-3 md:py-2">
        <div className="min-w-0 flex-1 md:grid md:grid-cols-[1fr_auto] md:items-center md:gap-x-3">
          <PopoverTitle id={titleId}>{label} 계산기</PopoverTitle>
          <PopoverDescription id={descriptionId} className="sr-only">
            계산 결과가 {label} 입력란에 원 단위로 반영됩니다.
          </PopoverDescription>
          <output
            className="mt-1 block min-h-7 overflow-hidden text-right text-xl font-semibold tabular-nums md:mt-0"
            aria-live="polite"
            aria-atomic="true"
          >
            {expression}원
          </output>
          <p className="mt-0.5 min-h-5 text-right text-xs text-red-700 md:col-span-2 md:mt-0 dark:text-[#ff9d93]" role={state.error ? 'alert' : undefined}>
            {state.error ?? ' '}
          </p>
        </div>
      </PopoverHeader>

      <div className="grid grid-cols-4 gap-2 p-3 md:gap-1.5 md:p-2" aria-label={`${label} 계산기 버튼`}>
        <Key label="전체 지우기" display="AC" onClick={() => onAction({ type: 'clear' })} utility />
        <Key label="세 자리 0 입력" display="000" onClick={() => onAction({ type: 'digits', digits: '000' })} utility />
        <Key label="한 자리 지우기" onClick={() => onAction({ type: 'backspace' })} utility>
          <Delete size={21} aria-hidden="true" />
        </Key>
        <OperatorKey item={operators[0]} active={state.operator === 'divide'} onAction={onAction} />

        <DigitKey digit="7" onAction={onAction} />
        <DigitKey digit="8" onAction={onAction} />
        <DigitKey digit="9" onAction={onAction} />
        <OperatorKey item={operators[1]} active={state.operator === 'multiply'} onAction={onAction} />

        <DigitKey digit="4" onAction={onAction} />
        <DigitKey digit="5" onAction={onAction} />
        <DigitKey digit="6" onAction={onAction} />
        <OperatorKey item={operators[2]} active={state.operator === 'subtract'} onAction={onAction} />

        <DigitKey digit="1" onAction={onAction} />
        <DigitKey digit="2" onAction={onAction} />
        <DigitKey digit="3" onAction={onAction} />
        <OperatorKey item={operators[3]} active={state.operator === 'add'} onAction={onAction} />

        <Key label="두 자리 0 입력" display="00" onClick={() => onAction({ type: 'digits', digits: '00' })} />
        <DigitKey digit="0" onAction={onAction} />
        {allowNegative ? (
          <Key label="부호 바꾸기" display="±" onClick={() => onAction({ type: 'toggle-sign' })} />
        ) : (
          <Key label="이 금액은 음수 입력 불가" display="±" onClick={() => undefined} disabled />
        )}
        <Key label="계산 결과 적용" display="=" onClick={() => onAction({ type: 'equals' })} operator />
      </div>

      <div className="shrink-0  px-3 pt-2 pb-[max(.75rem,env(safe-area-inset-bottom))] md:p-2">
        <PopoverClose render={<Button type="button" className="w-full" />}>
          완료
        </PopoverClose>
      </div>
    </PopoverContent>
  )
}

function DigitKey({ digit, onAction }: { digit: string; onAction: Props['onAction'] }) {
  return <Key label={`${digit} 입력`} display={digit} onClick={() => onAction({ type: 'digits', digits: digit })} />
}

function OperatorKey({
  item,
  active,
  onAction,
}: {
  item: (typeof operators)[number]
  active: boolean
  onAction: Props['onAction']
}) {
  return (
    <Key
      label={item.label}
      display={item.symbol}
      onClick={() => onAction({ type: 'operator', operator: item.operator })}
      operator
      pressed={active}
    />
  )
}

function Key({
  label,
  display,
  children,
  onClick,
  utility = false,
  operator = false,
  pressed,
  disabled,
}: {
  label: string
  display?: string
  children?: ReactNode
  onClick: () => void
  utility?: boolean
  operator?: boolean
  pressed?: boolean
  disabled?: boolean
}) {
  function handleClick() {
    requestMoneyKeypadHaptic()
    onClick()
  }

  return (
    <Button
      type="button"
      variant={operator ? 'primary' : utility ? 'ghost' : 'secondary'}
      className="min-h-12 px-2 text-lg tabular-nums md:min-h-11"
      aria-label={label}
      aria-pressed={pressed}
      onClick={handleClick}
      disabled={disabled}
    >
      {children ?? display}
    </Button>
  )
}
