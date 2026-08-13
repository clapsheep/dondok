import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, SquarePen, UsersRound } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { PageTitle } from '../../components/ui/PageTitle'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { RadioGroup, RadioGroupItem } from '../../components/ui/RadioGroup'
import { addMonths, currentMonthInSeoul, monthBounds, monthTitle, todayInSeoul } from '../../lib/month'
import {
  membershipApi,
  membershipKeys,
  type CurrentLedgerBook,
  type LedgerBook,
  type LedgerMember,
} from '../membership/api'
import type { LedgerNavigationState } from '../membership/ledgerLifecycle'
import { transactionApi, transactionKeys, type CalendarDay, type Transaction } from '../transactions/api'
import { transactionRowAccessibleName, transactionRowAmountPrefix, transactionRowDestination, transactionRowTone, transactionTypeLabel } from '../transactions/transactionRow'
import { compactCalendarWon, nextCalendarDate, selectedDateForMonth, shiftCalendarDate } from './calendarPresentation'

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : '요청을 처리하지 못했어요.'}</p>
}

export function HomePage({ current }: { current: CurrentLedgerBook }) {
  return (
    <AppShell ledgerNavigation={Boolean(current.ledger)}>
      {current.ledger ? <LedgerHome ledger={current.ledger} /> : <LedgerSetup />}
    </AppShell>
  )
}

function LedgerSetup() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const createLedger = useMutation({
    mutationFn: membershipApi.createLedger,
    onSuccess: (ledger) => queryClient.setQueryData(membershipKeys.current, { ledger }),
  })

  return (
    <section className="mx-auto max-w-2xl py-8 md:py-14">
      <div>
        <p className="text-sm font-semibold text-brass-500">첫 시작</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.035em] md:text-4xl">초대 코드를 받으셨나요?</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">받지 않았다면 새 가계부를 바로 시작하고, 받았다면 기존 가계부에 참여해요.</p>
        {ledgerLifecycleStatus(location.state)}
      </div>

      <div className="mt-8 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        <div className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <h2 className="font-semibold">초대 코드가 없어요</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">별도 설정 없이 내 가계부를 만들고 바로 기록을 시작해요.</p>
          </div>
          <Button
            type="button"
            className="w-full sm:w-auto"
            size="large"
            aria-label="가계부 시작하기 - 바로 시작하기"
            disabled={createLedger.isPending}
            onClick={() => createLedger.mutate()}
          >
            {createLedger.isPending && <LoaderCircle className="animate-spin" size={18} />}바로 시작하기
          </Button>
          {createLedger.error ? <div className="sm:col-span-2"><ErrorNotice error={createLedger.error} /></div> : null}
        </div>

        <div className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <h2 className="font-semibold">6자리 초대 코드를 받았어요</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">현재 구성원을 확인한 뒤 기존 가계부에 참여할 수 있어요.</p>
          </div>
          <Button asChild className="w-full sm:w-auto" variant="secondary" size="large">
            <Link to="/join">초대 코드 입력하기</Link>
          </Button>
        </div>
      </div>

      <p className="mt-5 text-xs leading-5 text-[var(--muted)]">로그인 아이디는 초대에 사용하거나 다른 구성원에게 공개하지 않아요.</p>
    </section>
  )
}

function LedgerHome({ ledger }: { ledger: LedgerBook }) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const currentMember = ledger.members.find((member) => member.currentUser)!
  const requestedMember = params.get('member')
  const selectedMemberKey = requestedMember === 'all'
    ? 'all'
    : ledger.members.some((member) => member.memberId === requestedMember)
      ? requestedMember!
      : currentMember.memberId
  const performedByMemberId = selectedMemberKey === 'all' ? undefined : selectedMemberKey
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : currentMonthInSeoul()
  const view = params.get('view') === 'daily' ? 'daily' : 'calendar'
  const dayDetailOpen = view === 'calendar' && params.get('detail') === 'day'
  const bounds = monthBounds(month)
  const selectedDate = selectedDateForMonth(params.get('date'), month, todayInSeoul())
  const selectedDateToExclusive = nextCalendarDate(selectedDate)
  const calendar = useQuery({
    queryKey: transactionKeys.calendar(month, performedByMemberId),
    queryFn: () => transactionApi.calendar(month, performedByMemberId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const transactions = useInfiniteQuery({
    queryKey: transactionKeys.list(bounds.from, bounds.toExclusive, performedByMemberId),
    queryFn: ({ pageParam }) => transactionApi.list({ from: bounds.from, toExclusive: bounds.toExclusive, cursor: pageParam, performedByMemberId }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: view === 'daily',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const selectedTransactions = useInfiniteQuery({
    queryKey: transactionKeys.list(selectedDate, selectedDateToExclusive, performedByMemberId),
    queryFn: ({ pageParam }) => transactionApi.list({ from: selectedDate, toExclusive: selectedDateToExclusive, cursor: pageParam, performedByMemberId }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: dayDetailOpen,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const loadMore = useRef<HTMLDivElement>(null)
  const items = useMemo(() => transactions.data?.pages.flatMap((page) => page.items) ?? [], [transactions.data])
  const groups = useMemo(() => groupTransactions(items), [items])
  const selectedItems = useMemo(() => selectedTransactions.data?.pages.flatMap((page) => page.items) ?? [], [selectedTransactions.data])
  const selectedDaySummary = calendar.data?.days.find((day) => day.date === selectedDate)
  const fetchNextPage = transactions.fetchNextPage
  const hasNextPage = transactions.hasNextPage
  const isFetchingNextPage = transactions.isFetchingNextPage

  useEffect(() => {
    const node = loadMore.current
    if (!node || view !== 'daily' || !hasNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '240px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, view])

  function moveMonth(offset: number) {
    const next = addMonths(month, offset)
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', next)
      updated.set('view', view)
      updated.delete('date')
      updated.delete('detail')
      return updated
    })
  }

  function changeView(nextView: 'calendar' | 'daily') {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', month)
      updated.set('view', nextView)
      if (nextView === 'daily') updated.delete('detail')
      return updated
    }, { replace: true })
  }

  function selectMember(nextMemberKey: string) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      if (nextMemberKey === currentMember.memberId) updated.delete('member')
      else updated.set('member', nextMemberKey)
      return updated
    }, { replace: true })
  }

  function selectDate(date: string) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', date.slice(0, 7))
      updated.set('view', 'calendar')
      updated.set('date', date)
      updated.set('detail', 'day')
      return updated
    })
  }

  function moveSelectedDate(offset: number) {
    const nextDate = shiftCalendarDate(selectedDate, offset)
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', nextDate.slice(0, 7))
      updated.set('view', 'calendar')
      updated.set('date', nextDate)
      updated.set('detail', 'day')
      return updated
    }, { replace: true })
  }

  function closeDayDetail() {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.delete('detail')
      return updated
    }, { replace: true })
  }

  return (
    <section className="max-w-[74rem] py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <PageTitle>가계부</PageTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="최신 거래 확인" onClick={() => queryClient.invalidateQueries({ queryKey: transactionKeys.all })}><RefreshCw size={18} /></Button>
          <Button asChild><Link to="/transactions/new"><SquarePen size={18} />기록</Link></Button>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-x-10">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="mt-2 flex items-center justify-between gap-2 lg:mt-0">
            <Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></Button>
            <h2 className="whitespace-nowrap text-sm font-medium tabular-nums text-[var(--muted)]" data-month-title>{monthTitle(month)}</h2>
            <Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={18} /></Button>
          </div>

          <CalendarMemberFilter
            members={ledger.members}
            currentMemberId={currentMember.memberId}
            value={selectedMemberKey}
            onChange={selectMember}
          />

          {transactionStatus(location.state)}
          {ledgerLifecycleStatus(location.state)}
        </div>

        <aside className="mt-4 border-y border-[var(--line)] lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:border-y-0 lg:border-l lg:pl-7" aria-label="이번 달 요약" data-home-desktop-summary>
          <h2 className="hidden text-xs font-semibold tracking-[.08em] text-[var(--muted)] lg:block">이번 달 요약</h2>
          <div className="grid grid-cols-3 py-3 text-center lg:mt-3 lg:grid-cols-1 lg:py-0 lg:text-left">
            <SummaryValue label="수입" value={calendar.data?.totalIncomeWon} tone="income" />
            <SummaryValue label="지출" value={calendar.data?.totalExpenseWon} tone="expense" />
            <SummaryValue label="순액" value={calendar.data?.netWon} tone="net" />
          </div>
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="mt-5 flex border-b border-[var(--line)]" role="group" aria-label="가계부 보기 방식">
            <ViewButton active={view === 'calendar'} onClick={() => changeView('calendar')}>월간 달력</ViewButton>
            <ViewButton active={view === 'daily'} onClick={() => changeView('daily')}>일별 보기</ViewButton>
          </div>

          {view === 'daily' && calendar.isError ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3 text-sm"><p role="alert">월 합계를 불러오지 못했어요. 일별 거래는 계속 볼 수 있어요.</p><Button variant="ghost" onClick={() => calendar.refetch()}>합계 다시 불러오기</Button></div> : null}

          {view === 'calendar' ? (
            calendar.isPending ? <LoadingRows label="달력을 불러오는 중…" /> : calendar.isError ? <HomeError onRetry={() => calendar.refetch()} /> : <>
              <MonthCalendar month={month} days={calendar.data?.days ?? []} selectedDate={selectedDate} onSelectDate={selectDate} />
            </>
          ) : transactions.isPending ? <LoadingRows label="거래를 불러오는 중…" /> : transactions.isError ? <HomeError onRetry={() => transactions.refetch()} /> : groups.length ? (
            <div className="mt-2">
              {groups.map((group) => <DayTransactions key={group.date} date={group.date} items={group.items} returnTo={`${location.pathname}${location.search}`} />)}
              <div ref={loadMore} className="grid min-h-16 place-items-center">
                {transactions.isFetchingNextPage ? <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle className="animate-spin" size={17} />다음 거래를 불러오는 중…</span> : transactions.hasNextPage ? <Button variant="ghost" onClick={() => transactions.fetchNextPage()}>거래 더 보기</Button> : <p className="text-xs text-[var(--muted)]">이 달의 거래를 모두 확인했어요.</p>}
              </div>
            </div>
          ) : <EmptyTransactions />}
        </div>
      </div>
      <DayDetailDialog
        open={dayDetailOpen}
        date={selectedDate}
        summary={selectedDaySummary}
        items={selectedItems}
        isSummaryPending={calendar.isPending || calendar.isError}
        isPending={selectedTransactions.isPending}
        isError={selectedTransactions.isError}
        hasNextPage={selectedTransactions.hasNextPage}
        isFetchingNextPage={selectedTransactions.isFetchingNextPage}
        onClose={closeDayDetail}
        onPrevious={() => moveSelectedDate(-1)}
        onNext={() => moveSelectedDate(1)}
        onRetry={() => selectedTransactions.refetch()}
        onLoadMore={() => selectedTransactions.fetchNextPage()}
        returnTo={`${location.pathname}${location.search}`}
      />
    </section>
  )
}

function CalendarMemberFilter({ members, currentMemberId, value, onChange }: {
  members: LedgerMember[]
  currentMemberId: string
  value: string
  onChange: (value: string) => void
}) {
  const orderedMembers = [...members].sort((left, right) => Number(right.currentUser) - Number(left.currentUser))
  return (
    <fieldset className="-mx-4 mt-1 min-w-0 xs:-mx-6 md:mx-0">
      <legend id="calendar-member-filter-label" className="sr-only">표시할 구성원</legend>
      <div className="overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xs:px-6 md:px-0">
        <RadioGroup
          name="calendar-member-filter"
          value={value}
          onValueChange={onChange}
          aria-labelledby="calendar-member-filter-label"
          className="flex w-max min-w-full items-end gap-1"
        >
          {orderedMembers.map((member) => (
            <CalendarMemberOption
              key={member.memberId}
              value={member.memberId}
              selected={value === member.memberId}
              label={member.currentUser ? '나' : member.displayName}
              accessibleLabel={member.memberId === currentMemberId ? '내 기록 보기' : `${member.displayName} 기록 보기`}
              avatar={<MemberAvatar displayName={member.displayName} memberId={member.memberId} size="xs" />}
            />
          ))}
          <CalendarMemberOption
            value="all"
            selected={value === 'all'}
            label="모두"
            accessibleLabel="모든 구성원 기록 보기"
            avatar={<UsersRound aria-hidden="true" size={16} />}
          />
        </RadioGroup>
      </div>
    </fieldset>
  )
}

function CalendarMemberOption({ value, selected, label, accessibleLabel, avatar }: {
  value: string
  selected: boolean
  label: string
  accessibleLabel: string
  avatar: ReactNode
}) {
  const id = `calendar-member-${value}`
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-inset focus-within:ring-[var(--ring)] ${selected ? 'border-forest-700 font-semibold text-forest-800 dark:border-forest-300 dark:text-forest-100' : 'border-transparent font-medium text-[var(--muted)] hover:text-ink-900 dark:hover:text-white'}`}
    >
      {avatar}
      <span className="max-w-36 whitespace-nowrap" title={label}>{label}</span>
      <RadioGroupItem id={id} value={value} className="sr-only" aria-label={accessibleLabel} />
    </label>
  )
}

function SummaryValue({ label, value, tone }: { label: string; value?: number; tone: 'income' | 'expense' | 'net' }) {
  const shown = value === undefined
    ? '—'
    : value === 0
      ? formatWon(0)
      : tone === 'income'
        ? `+${formatWon(value)}`
        : tone === 'expense'
          ? `${value < 0 ? '+' : '-'}${formatWon(value)}`
          : signedWon(value)
  const color = tone === 'income'
    ? 'text-[var(--income)]'
    : tone === 'expense' && value !== undefined && value < 0
      ? 'text-[var(--transfer)]'
    : tone === 'expense'
      ? 'text-[var(--expense)]'
      : ''
  return <dl className="min-w-0 border-r border-[var(--line)] px-2 last:border-r-0 lg:border-r-0 lg:border-b lg:px-0 lg:py-4 lg:last:border-b-0"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className={`mt-1 truncate text-sm font-semibold tabular-nums xs:text-base lg:mt-2 lg:text-xl ${color}`} title={shown}>{shown}</dd></dl>
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button variant="ghost" className={`rounded-none border-b-2 px-4 ${active ? 'border-forest-700 text-forest-800 dark:border-forest-100 dark:text-white' : 'border-transparent text-[var(--muted)] hover:text-ink-900 dark:hover:text-white'}`} type="button" aria-pressed={active} onClick={onClick}>{children}</Button>
}

function MonthCalendar({ month, days, selectedDate, onSelectDate }: { month: string; days: CalendarDay[]; selectedDate: string; onSelectDate: (date: string) => void }) {
  const { year, monthIndex, dayCount, leadingDays } = calendarMeta(month)
  const values = new Map(days.map((day) => [day.date, day]))
  const cellCount = Math.ceil((leadingDays + dayCount) / 7) * 7
  const today = todayInSeoul()
  return (
    <div className="-mx-4 mt-3 overflow-hidden border-y border-[var(--line)] xs:mx-0" role="grid" aria-label={`${year}년 ${monthIndex + 1}월 거래 달력`}>
      <div className="grid grid-cols-7 border-b border-[var(--line)] bg-[var(--surface)] text-center text-xs text-[var(--muted)]" role="row">{['일', '월', '화', '수', '목', '금', '토'].map((day) => <div className="py-2" role="columnheader" key={day}>{day}</div>)}</div>
      <div className="grid grid-cols-7">
        {Array.from({ length: cellCount }, (_, index) => {
          const day = index - leadingDays + 1
          if (day < 1 || day > dayCount) return <div className="min-h-20 border-r border-b border-[var(--line)] bg-black/[.025] last:border-r-0 dark:bg-white/[.025] md:min-h-24 lg:min-h-28" role="gridcell" key={`blank-${index}`} />
          const date = `${month}-${String(day).padStart(2, '0')}`
          const value = values.get(date)
          return (
            <div className="min-h-20 min-w-0 border-r border-b border-[var(--line)] last:border-r-0 md:min-h-24 lg:min-h-28" role="gridcell" aria-label={calendarCellLabel(date, value)} aria-selected={date === selectedDate} key={date}>
              <Button
                type="button"
                variant="ghost"
                className={`h-full min-h-20 w-full flex-col items-stretch justify-start gap-0 rounded-none px-1 py-1.5 text-left text-ink-900 hover:bg-forest-50 hover:text-ink-900 focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest-700 dark:text-white dark:hover:bg-forest-800 md:min-h-24 md:px-2 md:py-2 lg:min-h-28 ${date === selectedDate ? 'bg-forest-50/80 shadow-[inset_0_0_0_1px_var(--income)] dark:bg-forest-800/80' : ''}`}
                aria-label={`${calendarCellLabel(date, value)} 선택`}
                aria-pressed={date === selectedDate}
                onClick={() => onSelectDate(date)}
              >
                <time className={`block text-xs tabular-nums ${date === today ? 'font-bold text-forest-700 underline decoration-2 underline-offset-4 dark:text-forest-100' : ''}`} dateTime={date}>{day}</time>
                {value && (value.incomeWon !== 0 || value.expenseWon !== 0) ? <span className="mt-2 grid gap-1 text-[10px] font-semibold leading-none tracking-[-.04em] tabular-nums xs:text-xs md:tracking-normal">{value.incomeWon > 0 ? <span className="block whitespace-nowrap text-[var(--income)]" title={`수입 +${formatWon(value.incomeWon)}`}>+{compactCalendarWon(value.incomeWon)}</span> : null}{value.expenseWon > 0 ? <span className="block whitespace-nowrap text-[var(--expense)]" title={`지출 -${formatWon(value.expenseWon)}`}>-{compactCalendarWon(value.expenseWon)}</span> : value.expenseWon < 0 ? <span className="block whitespace-nowrap text-[var(--transfer)]" title={`환불 +${formatWon(value.expenseWon)}`}>+{compactCalendarWon(value.expenseWon)}</span> : null}</span> : null}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayDetailDialog({ open, date, summary, items, isSummaryPending, isPending, isError, hasNextPage, isFetchingNextPage, onClose, onPrevious, onNext, onRetry, onLoadMore, returnTo }: {
  open: boolean
  date: string
  summary?: CalendarDay
  items: Transaction[]
  isSummaryPending: boolean
  isPending: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  onRetry: () => void
  onLoadMore: () => void
  returnTo: string
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 p-0 shadow-none md:left-1/2 md:top-1/2 md:h-[min(46rem,calc(100dvh-3rem))] md:max-h-[calc(100dvh-3rem)] md:w-[min(42rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:shadow-lg">
        <header className="grid shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b border-[var(--line)] px-2 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] md:px-4 md:py-3">
          <Button type="button" variant="ghost" size="icon" aria-label="달력으로 돌아가기" onClick={onClose}><ArrowLeft size={20} /></Button>
          <div className="flex min-w-0 items-center justify-center gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label="이전 날" onClick={onPrevious}><ChevronLeft size={20} /></Button>
            <DialogTitle className="min-w-24 truncate text-center text-base tabular-nums md:text-xl">{dayTitle(date)}</DialogTitle>
            <Button type="button" variant="ghost" size="icon" aria-label="다음 날" onClick={onNext}><ChevronRight size={20} /></Button>
          </div>
          <span aria-hidden="true" />
          <DialogDescription className="sr-only">선택한 날짜의 수입과 지출 기록을 확인합니다.</DialogDescription>
        </header>

        <section className="flex min-h-0 flex-1 flex-col" role="region" aria-label={`${date} 거래 상세`}>
          <div className="shrink-0 border-b border-[var(--line)] px-4 py-3 md:px-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted)]">{isPending ? '거래를 불러오는 중' : `${items.length}${hasNextPage ? '건 이상' : '건'}`}</p>
              <p className="text-xs text-[var(--muted)]">이체·집계 제외 기록은 합계에서 제외돼요</p>
            </div>
            <dl className="mt-3 grid grid-cols-2 divide-x divide-[var(--line)]">
              <div className="pr-4"><dt className="text-xs text-[var(--muted)]">수입</dt><dd className="mt-1 text-base font-semibold tabular-nums text-[var(--income)] md:text-lg">{isSummaryPending ? '—' : summary?.incomeWon ? `+${formatWon(summary.incomeWon)}` : formatWon(0)}</dd></div>
              <div className="pl-4 text-right"><dt className="text-xs text-[var(--muted)]">지출</dt><dd className={`mt-1 text-base font-semibold tabular-nums md:text-lg ${summary && summary.expenseWon < 0 ? 'text-[var(--transfer)]' : 'text-[var(--expense)]'}`}>{isSummaryPending ? '—' : summary?.expenseWon ? `${summary.expenseWon < 0 ? '+' : '-'}${formatWon(summary.expenseWon)}` : formatWon(0)}</dd></div>
            </dl>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:pb-6">
            {isPending ? <LoadingRows label="선택한 날짜의 거래를 불러오는 중…" /> : isError ? <div className="py-10 text-center"><p role="alert">선택한 날짜의 거래를 불러오지 못했어요.</p><Button className="mt-4" variant="secondary" onClick={onRetry}>다시 불러오기</Button></div> : items.length ? <>
              <ul>{items.map((item) => <TransactionRow transaction={item} returnTo={returnTo} key={item.transactionId} />)}</ul>
              {hasNextPage ? <div className="grid min-h-16 place-items-center"><Button variant="ghost" disabled={isFetchingNextPage} onClick={onLoadMore}>{isFetchingNextPage ? <><LoaderCircle className="animate-spin" size={17} />불러오는 중…</> : '거래 더 보기'}</Button></div> : null}
            </> : <p className="py-12 text-center text-sm text-[var(--muted)]">이 날짜에 기록한 거래가 없어요.</p>}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

function DayTransactions({ date, items, returnTo }: { date: string; items: Transaction[]; returnTo: string }) {
  return (
    <section className="border-b border-[var(--line)]" aria-labelledby={`day-${date}`}>
      <header className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-[var(--line)] bg-cream-100 py-2 dark:bg-[#101714]"><h3 id={`day-${date}`} className="text-sm font-semibold">{dayTitle(date)}</h3><span className="text-xs text-[var(--muted)]">{items.length}건</span></header>
      <ul>{items.map((item) => <TransactionRow transaction={item} returnTo={returnTo} key={item.transactionId} />)}</ul>
    </section>
  )
}

function TransactionRow({ transaction, returnTo }: { transaction: Transaction; returnTo: string }) {
  const amount = `${transactionRowAmountPrefix(transaction)}${formatWon(transaction.amountWon)}`
  const tone = transactionRowTone(transaction)
  const label = transaction.description || transaction.category?.name || transactionTypeLabel(transaction)
  const content = <><div className="min-w-0"><p className="truncate text-sm font-semibold">{label}</p><div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]"><span className="truncate">{postingLabel(transaction)}</span>{transaction.performedBy ? <><span aria-hidden="true">·</span><MemberAvatar displayName={transaction.performedBy.displayName} memberId={transaction.performedBy.memberId} size="xs" /><span className="truncate">{transaction.performedBy.displayName}</span></> : null}{transaction.installmentCount && transaction.installmentCount > 1 ? <><span aria-hidden="true">·</span><span className="shrink-0">{transaction.installmentCount}개월</span></> : null}{transaction.excludedFromStatistics ? <><span aria-hidden="true">·</span><span className="shrink-0 font-semibold">집계 제외</span></> : null}</div></div><div className="text-right"><strong className={`text-sm font-semibold tabular-nums ${tone}`}>{amount}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{transactionTypeLabel(transaction)}</span></div></>
  const destination = transactionRowDestination(transaction)
  return <li className="border-b border-[var(--line)] last:border-b-0">{destination ? <Link to={destination} state={{ returnTo }} aria-label={transactionRowAccessibleName(transaction, label, amount)} className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 transition-colors hover:bg-forest-50 dark:hover:bg-forest-800 md:px-2">{content}</Link> : <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 md:px-2">{content}</div>}</li>
}

function LoadingRows({ label }: { label: string }) {
  return <div className="grid min-h-48 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />{label}</span></div>
}

function HomeError({ onRetry }: { onRetry: () => void }) {
  return <div className="border-b border-[var(--line)] py-12 text-center"><p role="alert">가계부 기록을 불러오지 못했어요.</p><Button className="mt-4" variant="secondary" onClick={onRetry}>다시 불러오기</Button></div>
}

function EmptyTransactions() {
  return <div className="border-b border-[var(--line)] py-16 text-center"><p className="font-semibold">이 달에 기록한 거래가 없어요.</p><p className="mt-2 text-sm text-[var(--muted)]">수입, 지출 또는 이체를 기록하면 날짜별로 이어서 볼 수 있어요.</p><Button asChild className="mt-5"><Link to="/transactions/new"><SquarePen size={18} />첫 거래 기록</Link></Button></div>
}

function groupTransactions(items: Transaction[]) {
  const groups = new Map<string, Transaction[]>()
  for (const item of items) {
    const group = groups.get(item.occurredOn)
    if (group) group.push(item)
    else groups.set(item.occurredOn, [item])
  }
  return [...groups].map(([date, groupedItems]) => ({ date, items: groupedItems }))
}

function postingLabel(transaction: Transaction) {
  if (transaction.managementType === 'CARD_REFUND') {
    const returnedAssets = [...new Set(transaction.postings
      .filter((posting) => posting.deltaWon > 0)
      .map((posting) => posting.assetName))]
    return returnedAssets.length ? `${returnedAssets.join(' · ')} 장부 반환` : '카드·계좌 장부 반영'
  }
  if (transaction.type === 'TRANSFER') {
    const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetName
    const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetName
    return source && destination ? `${source} → ${destination}` : '자산 이체'
  }
  const postingAsset = transaction.postings[0]
  if (transaction.asset && postingAsset && transaction.asset.assetId !== postingAsset.assetId) {
    return `${transaction.asset.name} · ${postingAsset.assetName}에서 차감`
  }
  return transaction.asset?.name ?? postingAsset?.assetName ?? '자산'
}

function transactionStatus(state: unknown) {
  const navigation = state as { transactionSaved?: boolean; transactionUpdated?: boolean; transactionDeleted?: boolean } | null
  const message = navigation?.transactionSaved ? '거래를 기록했어요.' : navigation?.transactionUpdated ? '거래를 수정했어요.' : navigation?.transactionDeleted ? '거래를 삭제했어요.' : undefined
  return message ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">{message}</p> : null
}

function ledgerLifecycleStatus(state: unknown) {
  const reason = (state as LedgerNavigationState | null)?.ledgerExit
  const message = reason === 'DELETED'
    ? '가계부를 삭제했어요. 로그인은 유지되어 새 가계부를 시작하거나 초대 코드로 참여할 수 있어요.'
    : reason === 'DELETED_REMOTELY'
      ? '다른 구성원이 가계부를 삭제했어요. 새 가계부를 시작하거나 초대 코드로 참여할 수 있어요.'
      : reason === 'LEDGER_CHANGED'
        ? '현재 가계부가 바뀌어 이전 화면의 삭제 요청은 적용하지 않았어요.'
        : undefined
  return message ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">{message}</p> : null
}

function dayTitle(date: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T00:00:00+09:00`)) }
function calendarMeta(month: string) { const [year, value] = month.split('-').map(Number); return { year, monthIndex: value - 1, dayCount: new Date(Date.UTC(year, value, 0)).getUTCDate(), leadingDays: new Date(Date.UTC(year, value - 1, 1)).getUTCDay() } }
function formatWon(value: number) { return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원` }
function signedWon(value: number) { return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatWon(value)}` }

function calendarCellLabel(date: string, value?: { incomeWon: number; expenseWon: number }) {
  const amounts: string[] = []
  if (value && value.incomeWon > 0) amounts.push(`수입 +${formatWon(value.incomeWon)}`)
  if (value && value.expenseWon > 0) amounts.push(`지출 -${formatWon(value.expenseWon)}`)
  if (value && value.expenseWon < 0) amounts.push(`환불 +${formatWon(value.expenseWon)}`)
  return amounts.length ? `${dayTitle(date)}, ${amounts.join(', ')}` : `${dayTitle(date)}, 거래 없음`
}
