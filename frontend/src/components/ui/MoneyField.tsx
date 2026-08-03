import { useRef, type ChangeEvent, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Input } from './Input'
import { Label } from './Label'
import { formatWonInput, normalizeWonInput } from './moneyInput'

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
  const describedBy = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
  const formattedValue = formatWonInput(value)
  const negative = value.startsWith('-')

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selectionStart = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    const digitsToRight = event.currentTarget.value.slice(selectionStart).replace(/\D/g, '').length
    const normalized = normalizeWonInput(event.currentTarget.value, allowNegative)
    if (normalized === null) return

    onValueChange(normalized)
    const nextFormatted = formatWonInput(normalized)
    requestAnimationFrame(() => restoreCaret(inputRef.current, nextFormatted, digitsToRight))
  }

  return (
    <div data-slot="money-field" data-invalid={Boolean(error)} className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative min-w-0">
        <Input
          {...props}
          ref={inputRef}
          id={id}
          type="text"
          inputMode={allowNegative ? 'text' : 'numeric'}
          value={formattedValue}
          onChange={handleChange}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'min-h-14 pr-12 text-right text-xl font-semibold tracking-[-.025em] tabular-nums sm:text-2xl',
            negative && 'text-[var(--expense)] dark:text-[var(--expense)]',
            inputClassName,
          )}
        />
        <span className={cn('pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-[var(--muted)]', negative && 'text-[var(--expense)]')} aria-hidden="true">원</span>
      </div>
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
