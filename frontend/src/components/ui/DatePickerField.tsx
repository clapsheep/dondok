import { CalendarDays, ChevronDown, X } from 'lucide-react'
import { lazy, Suspense, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Label } from './Label'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './Popover'

const Calendar = lazy(() => import('./Calendar').then((module) => ({ default: module.Calendar })))

type Props = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  error?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
}

export function DatePickerField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  disabled = false,
  required = false,
  placeholder = '날짜를 선택해 주세요',
}: Props) {
  const generatedId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = parseDateValue(value)
  const today = todayInSeoul()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(selected ?? today)
  const titleId = `${id}-${generatedId}-title`
  const descriptionId = `${id}-${generatedId}-description`
  const valueDescriptionId = `${id}-${generatedId}-value`
  const describedBy = [valueDescriptionId, hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ')

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setMonth(selected ?? today)
    setOpen(nextOpen)
  }

  function selectDate(date: Date | undefined) {
    if (!date) return
    onChange(toDateValue(date))
    setMonth(date)
    setOpen(false)
  }

  return (
    <div data-slot="field" data-date-picker-field data-invalid={Boolean(error)} className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={handleOpenChange} modal>
        <PopoverTrigger
          render={(
            <Button
              ref={trigger}
              id={id}
              type="button"
              variant="secondary"
              className="min-h-12 w-full min-w-0 justify-start px-3 text-left text-base font-normal tabular-nums"
              data-value={value}
              aria-label={label}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              aria-required={required}
              disabled={disabled}
            />
          )}
        >
          <CalendarDays className="shrink-0 text-forest-700 dark:text-forest-100" size={18} aria-hidden="true" />
          <span className={selected ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-[var(--muted)]'}>{selected ? formatDateDisplay(selected) : placeholder}</span>
          <ChevronDown className="ml-auto shrink-0 text-[var(--muted)]" size={18} aria-hidden="true" />
        </PopoverTrigger>

        <PopoverContent
          className="max-h-[calc(100dvh-1rem)] md:max-h-[min(78dvh,44rem)] md:w-[22rem]"
          positionerClassName="date-picker-positioner"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          finalFocus={trigger}
        >
          <PopoverHeader className="shrink-0 border-b border-[var(--line)] px-4 py-3">
            <div className="min-w-0">
              <PopoverTitle id={titleId}>{label} 선택</PopoverTitle>
              <PopoverDescription id={descriptionId} className="sr-only md:not-sr-only md:mt-0.5">월을 이동한 뒤 날짜를 선택해 주세요.</PopoverDescription>
            </div>
            <PopoverClose
              render={<Button type="button" size="icon" variant="ghost" className="shrink-0" aria-label={`${label} 선택 닫기`} />}
            >
              <X size={19} />
            </PopoverClose>
          </PopoverHeader>

          <div className="min-h-[22.75rem] px-3 py-2 sm:px-4">
            <Suspense fallback={<div className="grid h-[21.75rem] place-items-center text-sm text-[var(--muted)]" role="status">달력을 불러오는 중이에요.</div>}>
              <Calendar
                mode="single"
                selected={selected}
                month={month}
                onMonthChange={setMonth}
                onSelect={selectDate}
                autoFocus
                labels={{ labelPrevious: () => '이전 달', labelNext: () => '다음 달' }}
                footer={selected ? `${formatDateDisplay(selected)} 선택됨` : '선택된 날짜 없음'}
                aria-label={`${label} 달력`}
              />
            </Suspense>
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-[var(--line)] px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 md:pb-3">
            <span className="text-xs text-[var(--muted)]">{selected ? formatDateDisplay(selected) : '날짜를 선택해 주세요'}</span>
            <Button type="button" variant="ghost" className="min-h-11 px-3" onClick={() => selectDate(today)}>오늘</Button>
          </div>
        </PopoverContent>
      </Popover>
      <span id={valueDescriptionId} className="sr-only">현재 선택: {selected ? formatDateDisplay(selected) : '없음'}</span>
      {hint ? <p id={`${id}-hint`} data-slot="field-description" className="text-xs text-[var(--muted)]">{hint}</p> : null}
      {error ? <p id={`${id}-error`} data-slot="field-error" className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}

function parseDateValue(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  return date
}

function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDateDisplay(date: Date): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`
}

function todayInSeoul(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return new Date(Number(valueByType.year), Number(valueByType.month) - 1, Number(valueByType.day), 12)
}
