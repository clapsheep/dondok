import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { TZDate } from 'react-day-picker'
import { addMonths, monthTitle, todayInSeoul } from '../../lib/month'
import { Button } from './Button'
import { Calendar } from './Calendar'

export type DateRangeValue = { from: string; to: string }

export function DateRangeCalendar({ value, onChange }: { value: DateRangeValue; onChange: (value: DateRangeValue) => void }) {
  const [month, setMonth] = useState(() => (value.from || value.to || todayInSeoul()).slice(0, 7))
  const selected = value.from ? { from: toDate(value.from), to: value.to ? toDate(value.to) : undefined } : undefined

  function selectDay(day: Date) {
    const date = toValue(day)
    if (!value.from || value.to) onChange({ from: date, to: '' })
    else onChange({ from: date < value.from ? date : value.from, to: date < value.from ? value.from : date })
  }

  return <div className="min-w-0">
    <div className="flex items-center justify-between">
      <Button type="button" size="icon" variant="ghost" aria-label="기간 이전 달" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></Button>
      <Button type="button" variant="ghost" className="px-2 text-sm text-[var(--foreground)] dark:text-[var(--foreground)]" aria-label={`${monthTitle(month)} 전체 선택`} title="눌러서 이달 전체 선택" onClick={() => onChange({ from: `${month}-01`, to: toValue(new TZDate(Number(month.slice(0, 4)), Number(month.slice(5)), 0, 12, 'Asia/Seoul')) })}>{monthTitle(month)}</Button>
      <Button type="button" size="icon" variant="ghost" aria-label="기간 다음 달" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></Button>
    </div>
    <Calendar
      mode="range"
      selected={selected}
      month={toDate(`${month}-01`)}
      onMonthChange={(date) => setMonth(toValue(date).slice(0, 7))}
      onSelect={(_, date) => selectDay(date)}
      hideNavigation
      aria-label="조회 기간 달력"
      labels={{ labelDayButton: (date) => toValue(date) }}
      classNames={{
        month_caption: 'hidden',
        weekdays: '',
        week: '',
        day_button: 'relative mx-auto grid h-10 w-full max-w-11 place-items-center rounded-md text-sm tabular-nums hover:bg-[var(--surface-hover)] focus-visible:z-20',
        selected: '',
        range_start: 'rounded-l-md bg-[var(--surface-selected)] [&>button]:bg-[var(--selection)] [&>button]:font-semibold [&>button]:text-[var(--background)]',
        range_end: 'rounded-r-md bg-[var(--surface-selected)] [&>button]:bg-[var(--selection)] [&>button]:font-semibold [&>button]:text-[var(--background)]',
        range_middle: 'bg-[var(--surface-selected)] [&>button]:text-[var(--foreground)]',
      }}
    />
    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--line-subtle)] pt-3 text-xs">
      <div><span className="text-[var(--muted)]">시작일</span><output aria-label="선택한 시작일" className="mt-1 block tabular-nums">{value.from || '선택 전'}</output></div>
      <div><span className="text-[var(--muted)]">종료일</span><output aria-label="선택한 종료일" className="mt-1 block tabular-nums">{value.to || '선택 전'}</output></div>
    </div>
    <p role="status" className="mt-2 text-xs text-[var(--muted)]">{value.from && !value.to ? '종료일을 선택해 주세요.' : '날짜 두 번으로 기간 선택 · 월 제목으로 한 달 선택'}</p>
  </div>
}

function toDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new TZDate(year, month - 1, day, 12, 'Asia/Seoul')
}

function toValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
