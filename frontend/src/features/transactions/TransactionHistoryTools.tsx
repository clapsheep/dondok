import { CalendarDays, ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { lazy, Suspense, useId, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CompactSelect } from '../../components/ui/CompactSelect'
import { Input } from '../../components/ui/Input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../components/ui/Popover'
import type { LedgerMember } from '../membership/api'
import type { TransactionFilters, TransactionType } from './api'

const DateRangeCalendar = lazy(() => import('../../components/ui/DateRangeCalendar').then((module) => ({ default: module.DateRangeCalendar })))

const typeOptions = [{ value: '', label: '모든 종류' }, { value: 'INCOME', label: '수입' }, { value: 'EXPENSE', label: '지출' }, { value: 'TRANSFER', label: '이체' }]
export function TransactionHistoryTools({ filters, members, onChange }: { filters: TransactionFilters; members: LedgerMember[]; onChange: (filters: TransactionFilters) => void }) {
  const id = useId()
  const [searchOpen, setSearchOpen] = useState(Boolean(filters.q))
  const [search, setSearch] = useState(filters.q ?? '')
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [period, setPeriod] = useState({ from: filters.from ?? '', to: filters.toExclusive ? shiftDay(filters.toExclusive, -1) : '' })
  const [appliedSearch, setAppliedSearch] = useState(filters.q)
  if (appliedSearch !== filters.q) {
    setAppliedSearch(filters.q)
    setSearch(filters.q ?? '')
  }
  function openPeriod(open: boolean) {
    if (open) { setPeriod({ from: filters.from ?? '', to: filters.toExclusive ? shiftDay(filters.toExclusive, -1) : '' }) }
    setPeriodOpen(open)
  }
  return <>
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">거래 내역</h2>
      <div className="flex items-center">
        <Button size="icon" variant="ghost" aria-label="거래 검색" title="거래 검색" aria-expanded={searchOpen} aria-controls={`${id}-search`} onClick={() => setSearchOpen((value) => !value)}><Search size={18} /></Button>
        <Button size="icon" variant="ghost" aria-label="거래 필터" title="거래 필터" aria-expanded={filterOpen} aria-controls={`${id}-filters`} onClick={() => { setPeriodOpen(false); setFilterOpen((value) => !value) }}><SlidersHorizontal size={18} /></Button>
      </div>
    </div>
    {filterOpen ? <div id={`${id}-filters`} role="group" aria-label="거래 필터" className="flex min-w-0 items-center gap-1.5" data-transaction-filter-tools>
      <CompactSelect label="거래 종류" className="w-[4.5rem] shrink-0" value={filters.type ?? ''} onChange={(type) => onChange({ ...filters, type: type ? type as TransactionType : undefined })} options={typeOptions} />
      <Popover open={periodOpen} onOpenChange={openPeriod} modal={false}>
        <PopoverTrigger render={<Button type="button" variant="ghost" className="w-[4.5rem] shrink-0 p-0 hover:bg-transparent" aria-label="조회 기간" />}>
          <span className="flex h-8 w-full items-center justify-center gap-1 rounded-md bg-[var(--surface-hover)] px-2 text-[13px] font-normal text-[var(--foreground)] hover:bg-[var(--surface-selected)]"><CalendarDays size={13} />기간<ChevronDown size={12} /></span>
        </PopoverTrigger>
        <PopoverContent backdropClassName="bg-transparent" className="max-h-[min(78dvh,36rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border-[var(--control-border)] bg-[var(--background)] p-3 shadow-md md:w-80" positionerProps={{ align: 'end', sideOffset: 4, positionMethod: 'fixed' }} aria-label="기간 선택">
          <PopoverTitle className="sr-only">조회 기간</PopoverTitle>
          <Suspense fallback={<p role="status" className="py-12 text-center text-sm text-[var(--muted)]">달력을 불러오는 중이에요.</p>}>
            <DateRangeCalendar value={period} onChange={setPeriod} />
          </Suspense>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" className="px-2 text-xs font-medium" onClick={() => { onChange({ ...filters, from: undefined, toExclusive: undefined }); setPeriodOpen(false) }}>기간 지우기</Button>
            <Button type="button" className="px-3 text-xs font-medium" aria-label="기간 적용" disabled={!period.from || !period.to} onClick={() => {
              onChange({ ...filters, from: period.from, toExclusive: shiftDay(period.to, 1) })
              setPeriodOpen(false)
            }}>적용</Button>
          </div>
        </PopoverContent>
      </Popover>
      <CompactSelect label="구성원" className="min-w-0 max-w-24 shrink" value={filters.performedByMemberId ?? ''} onChange={(member) => onChange({ ...filters, performedByMemberId: member || undefined })} options={[{ value: '', label: '모든 구성원' }, ...members.map((member) => ({ value: member.memberId, label: member.currentUser ? '나' : member.displayName }))]} />
      <Button type="button" size="icon" variant="ghost" className="shrink-0 text-[var(--muted)] dark:text-[var(--muted)]" aria-label="필터 초기화" title="필터 초기화" onClick={() => onChange({ q: filters.q })}><RotateCcw size={15} /></Button>
    </div> : null}
    {searchOpen ? <form id={`${id}-search`} className="mt-1 flex min-w-0 items-center gap-1" role="search" onSubmit={(event) => { event.preventDefault(); onChange({ ...filters, q: search.trim() || undefined }) }}>
      <div className="relative min-w-0 flex-1"><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><Input autoFocus aria-label="거래 검색어" placeholder="내용·분류 검색" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9 pr-10" />
        {search ? <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-1/2 -translate-y-1/2 text-[var(--muted)] dark:text-[var(--muted)]" aria-label="검색 초기화" onClick={() => { setSearch(''); onChange({ ...filters, q: undefined }) }}><X size={15} /></Button> : null}
      </div>
      <Button type="submit" variant="ghost" className="shrink-0 px-2 text-xs font-medium">검색</Button>
    </form> : null}
  </>
}

function shiftDay(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
