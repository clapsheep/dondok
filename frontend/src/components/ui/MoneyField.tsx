import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Input } from './Input'
import { Label } from './Label'
import { MoneyCalculatorKeypad } from './MoneyCalculatorKeypad'
import { Popover, PopoverTrigger } from './Popover'
import {
  createMoneyCalculatorState,
  formatWonInput,
  moneyCalculatorReducer,
  normalizeWonInput,
  type MoneyCalculatorAction,
} from './moneyInput'

type Props = Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'inputMode'> & {
  label: string
  value: string
  onValueChange: (value: string) => void
  hint?: ReactNode
  error?: string
  allowNegative?: boolean
  inputClassName?: string
}

export function MoneyField({ id, label, value, onValueChange, hint, error, allowNegative = false, inputClassName, ...props }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const calculatorRef = useRef(createMoneyCalculatorState(value))
  const [calculator, setCalculator] = useState(() => createMoneyCalculatorState(value))
  const [open, setOpen] = useState(false)
  const describedBy = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
  const formattedValue = formatWonInput(value)
  const negative = value.startsWith('-')

  useEffect(() => {
    if (calculatorRef.current.value === value) return
    const next = createMoneyCalculatorState(value)
    calculatorRef.current = next
    setCalculator(next)
  }, [value])

  function resetCalculator(nextValue: string) {
    const next = createMoneyCalculatorState(nextValue)
    calculatorRef.current = next
    setCalculator(next)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) resetCalculator(value)
    setOpen(nextOpen)
  }

  function handleCalculatorAction(action: MoneyCalculatorAction) {
    const previous = calculatorRef.current
    const next = moneyCalculatorReducer(previous, action, allowNegative)
    calculatorRef.current = next
    setCalculator(next)
    if (next.value !== previous.value) onValueChange(next.value)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selectionStart = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    const digitsToRight = event.currentTarget.value.slice(selectionStart).replace(/\D/g, '').length
    const normalized = normalizeWonInput(event.currentTarget.value, allowNegative)
    if (normalized === null) return

    resetCalculator(normalized)
    onValueChange(normalized)
    const nextFormatted = formatWonInput(normalized)
    requestAnimationFrame(() => restoreCaret(inputRef.current, nextFormatted, digitsToRight))
  }

  return (
    <div data-slot="money-field" data-invalid={Boolean(error)} className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <div className="relative min-w-0">
          <PopoverTrigger
            nativeButton={false}
            render={(
              <Input
                {...props}
                ref={inputRef}
                id={id}
                type="text"
                inputMode="none"
                value={formattedValue}
                onChange={handleChange}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy}
                aria-haspopup="dialog"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'min-h-12 pointer-coarse:min-h-12 pr-12 text-right text-xl pointer-coarse:text-xl font-semibold tracking-[-.025em] tabular-nums',
                  negative && 'text-[var(--expense)] dark:text-[var(--expense)]',
                  inputClassName,
                )}
              />
            )}
          />
          <span className={cn('pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-[var(--muted)]', negative && 'text-[var(--expense)]')} aria-hidden="true">원</span>
        </div>
        <MoneyCalculatorKeypad
          id={id ?? 'money'}
          label={label}
          state={calculator}
          allowNegative={allowNegative}
          onAction={handleCalculatorAction}
        />
      </Popover>
      {hint ? <p id={`${id}-hint`} data-slot="field-description" className="text-xs text-[var(--muted)]">{hint}</p> : null}
      {error ? <p id={`${id}-error`} data-slot="field-error" className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}

function restoreCaret(input: HTMLInputElement | null, expectedValue: string, digitsToRight: number) {
  if (!input || input.value !== expectedValue) return
  let caret = expectedValue.length
  let remainingDigits = digitsToRight
  while (caret > 0 && remainingDigits > 0) {
    caret -= 1
    if (/\d/.test(expectedValue[caret] ?? '')) remainingDigits -= 1
  }
  input.setSelectionRange(caret, caret)
}
