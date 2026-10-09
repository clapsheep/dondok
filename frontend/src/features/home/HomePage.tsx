import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, List, LoaderCircle, Plus, RefreshCw, SquarePen, UsersRound } from 'lucide-react'
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import './home-layout.css'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup } from '../../components/ui/RadioGroup'
import { addMonths, currentMonthInSeoul, monthBounds, monthTitle, todayInSeoul } from '../../lib/month'
import {
  membershipApi,
  membershipKeys,
  type CurrentLedgerBook,
  type LedgerBook,
  type LedgerMember,
} from '../membership/api'
import type { LedgerNavigationState } from '../membership/ledgerLifecycle'
import { transactionApi, transactionKeys, type CalendarDay, type Transaction, type TransactionFilters } from '../transactions/api'
import { transactionRowAccessibleName, transactionRowAmountPrefix, transactionRowDestination, transactionTypeLabel } from '../transactions/transactionRow'
import { calendarAmount, nextCalendarDate, selectedDateForMonth, shiftCalendarDate } from './calendarPresentation'
import { TransactionList, TransactionListRow } from '../transactions/TransactionDateGroup'
import { TransactionHistory } from '../transactions/TransactionHistory'
import { readTransactionFilters, writeTransactionFilters } from '../transactions/transactionFilters'
import { groupTransactionsByDate } from '../transactions/groupTransactionsByDate'

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
        <Link to="/settings?section=account" className="mb-3 inline-flex min-h-11 items-center text-sm text-[var(--muted)] underline underline-offset-4">내 계정 설정</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.035em] md:text-4xl">초대 코드를 받으셨나요?</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">받지 않았다면 새 가계부를 바로 시작하고, 받았다면 기존 가계부에 참여해요.</p>
        {ledgerLifecycleStatus(location.state)}
      </div>

      <div className="mt-8 grid gap-4">
        <div className="ui-soft-panel grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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

        <div className="ui-soft-panel grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
  const online = useOnlineStatus()
  const calendarRef = useRef<HTMLDivElement>(null)
  const dayRef = useRef<HTMLElement>(null)
  const bounds = monthBounds(month)
  const filters = useMemo(() => ({ ...readTransactionFilters(params), performedByMemberId }), [params, performedByMemberId])
  const customRange = Boolean(filters.q || filters.type || filters.from || filters.toExclusive)
  const dailyFrom = customRange ? filters.from : bounds.from
  const dailyToExclusive = customRange ? filters.toExclusive : bounds.toExclusive
  function changeFilters(next: TransactionFilters) {
    setParams((previous) => {
      const updated = writeTransactionFilters(previous, next)
      updated.delete('performedByMemberId')
      updated.set('member', next.performedByMemberId ?? 'all')
      return updated
    })
  }
  const selectedDate = selectedDateForMonth(params.get('date'), month, todayInSeoul())
  const selectedDateToExclusive = nextCalendarDate(selectedDate)
  const calendar = useQuery({
    queryKey: transactionKeys.calendar(month, performedByMemberId),
    queryFn: () => transactionApi.calendar(month, performedByMemberId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const transactions = useInfiniteQuery({
    queryKey: transactionKeys.list(dailyFrom, dailyToExclusive, performedByMemberId, { q: filters.q, type: filters.type }),
    queryFn: ({ pageParam }) => transactionApi.list({ ...filters, from: dailyFrom, toExclusive: dailyToExclusive, cursor: pageParam }),
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
    enabled: view === 'calendar',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const loadMore = useRef<HTMLDivElement>(null)
  const items = useMemo(() => transactions.data?.pages.flatMap((page) => page.items) ?? [], [transactions.data])
  const groups = useMemo(() => groupTransactionsByDate(items, (item) => item.occurredOn), [items])
  const selectedItems = useMemo(() => selectedTransactions.data?.pages.flatMap((page) => page.items) ?? [], [selectedTransactions.data])
  const selectedDaySummary = calendar.data?.days.find((day) => day.date === selectedDate)
  const refreshTransactions = useCallback(
    () => queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
    [queryClient],
  )
  const pullToRefreshRoot = useRef<HTMLElement>(null)
  const { distance: pullDistance, refreshing: pullRefreshing } = useMobilePullToRefresh(pullToRefreshRoot, true, refreshTransactions)
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
      for (const key of ['q', 'type', 'from', 'toExclusive']) updated.delete(key)
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

  function scrollToDay() {
    if (dayRef.current && getComputedStyle(dayRef.current).getPropertyValue('--stacked-day').trim() === '1') {
      requestAnimationFrame(() => dayRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
    }
  }

  function selectDate(date: string) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', date.slice(0, 7))
      updated.set('view', 'calendar')
      updated.set('date', date)
      updated.delete('detail')
      return updated
    })
    scrollToDay()
  }

  function moveSelectedDate(offset: number) {
    const nextDate = shiftCalendarDate(selectedDate, offset)
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', nextDate.slice(0, 7))
      updated.set('view', 'calendar')
      updated.set('date', nextDate)
      updated.delete('detail')
      return updated
    }, { replace: true })
  }

  const returnTo = `${location.pathname}${location.search}`
  const scopeLabel = selectedMemberKey === 'all' ? '모든 구성원' : selectedMemberKey === currentMember.memberId ? '나' : ledger.members.find(member => member.memberId === selectedMemberKey)?.displayName ?? '구성원'
  const showAmount = (value?: number) => value === undefined ? '—' : `${value < 0 ? '-' : ''}${formatWon(value)}`
  return (
    <section ref={pullToRefreshRoot} className="home-page" data-home-ledger>
      <PullToRefreshIndicator distance={pullDistance} refreshing={pullRefreshing}/>
      <header className="home-heading"><div><p>나란히 쌓아가는 우리의 기록</p><h1>가계부</h1></div><Button asChild><Link to="/transactions/new" state={{ returnTo }}><Plus size={18}/>기록하기</Link></Button></header>
      {transactionStatus(location.state)}{ledgerLifecycleStatus(location.state)}
      {!online ? <p className="ui-notice" role="status">오프라인 상태예요. 마지막으로 불러온 기록을 표시하며 연결 후 최신값을 확인할 수 있어요.</p> : null}
      <section className="home-summary" aria-label="이번 달 요약" data-home-desktop-summary>
        <div><span>{Number(month.slice(5))}월에 쓴 돈</span><strong className="home-total">{showAmount(calendar.data?.totalExpenseWon)}</strong><p>{scopeLabel}의 기록을 보고 있어요</p></div>
        <dl><div><dt><ArrowDownLeft size={15}/>수입</dt><dd>{showAmount(calendar.data?.totalIncomeWon)}</dd></div><div><dt><ArrowUpRight size={15}/>수입 − 지출</dt><dd>{showAmount(calendar.data?.netWon)}</dd></div></dl>
      </section>
      <div className="home-controls"><CalendarMemberFilter members={ledger.members} currentMemberId={currentMember.memberId} value={selectedMemberKey} onChange={selectMember}/>
        <SegmentedControl label="가계부 보기 방식" value={view} onChange={value => changeView(value as 'calendar' | 'daily')} options={[{value:'calendar',label:<><CalendarDays size={16}/><span>달력</span></>,accessibleLabel:'월간 달력'},{value:'daily',label:<><List size={16}/><span>일별</span></>,accessibleLabel:'일별 보기'}]}/>
      </div>
      {calendar.isError ? <div className="ui-notice" role="alert">월 합계를 불러오지 못했어요.{calendar.data ? ' 마지막으로 불러온 값을 표시합니다.' : ''}<Button variant="ghost" disabled={!online} onClick={() => calendar.refetch()}>합계 다시 불러오기</Button></div> : null}
      <div className="home-layout" data-view={view}>
        <div className="home-calendar-section" ref={calendarRef}>
          <div className="home-monthbar"><div className="home-month"><h2 data-month-title>{monthTitle(month)}</h2><Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={18}/></Button><Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={18}/></Button></div><div className="flex shrink-0 items-center"><Button variant="ghost" size="icon" aria-label="최신값 확인" disabled={!online || calendar.isFetching} onClick={() => refreshTransactions()}><RefreshCw size={16} className={calendar.isFetching ? 'animate-spin' : undefined}/></Button><Button variant="ghost" onClick={() => selectDate(todayInSeoul())}>오늘</Button></div></div>
          {view === 'calendar' ? calendar.isPending ? <LoadingRows label="달력을 불러오는 중…"/> : calendar.isError && !calendar.data ? <HomeError onRetry={() => calendar.refetch()}/> : <><MonthCalendar month={month} days={calendar.data?.days ?? []} selectedDate={selectedDate} onSelectDate={selectDate}/><p className="home-calendar-note">카드 대금 결제는 수입·지출 합계에 포함하지 않아요.</p></> : <TransactionHistory
            filters={filters} members={ledger.members} onFiltersChange={changeFilters}
            groups={groups} renderItem={(item) => <TransactionRow transaction={item} returnTo={returnTo}/>}
            itemKey={(item) => item.transactionId}
            isPending={transactions.isPending} isError={transactions.isError && !transactions.data}
            onRetry={() => { void transactions.refetch() }}
            emptyState={!customRange ? <EmptyTransactions/> : undefined}
            footer={<div ref={loadMore} className="grid min-h-16 place-items-center">
              {transactions.isFetchingNextPage ? <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle className="animate-spin" size={17}/>다음 거래를 불러오는 중…</span> : transactions.hasNextPage ? <Button variant="ghost" onClick={() => transactions.fetchNextPage()}>거래 더 보기</Button> : <p className="text-xs text-[var(--muted)]">거래를 모두 확인했어요.</p>}
              {transactions.isError && transactions.data ? <div role="alert"><p>추가 기록을 불러오지 못했어요.</p><Button variant="ghost" onClick={() => transactions.refetch()}>다시 불러오기</Button></div> : null}
            </div>}
          />}
        </div>
        {view === 'calendar' ? <aside className="home-day-panel" ref={dayRef} aria-label="선택한 날짜의 기록">
          <DayDetailPanel date={selectedDate} summary={selectedDaySummary} items={selectedItems}
            isSummaryPending={!calendar.data} isPending={selectedTransactions.isPending}
            isError={selectedTransactions.isError} hasNextPage={selectedTransactions.hasNextPage}
            isFetchingNextPage={selectedTransactions.isFetchingNextPage}
            onPrevious={() => moveSelectedDate(-1)} onNext={() => moveSelectedDate(1)}
            onBack={() => calendarRef.current?.scrollIntoView({behavior:'instant',block:'start'})}
            onRetry={() => selectedTransactions.refetch()} onLoadMore={() => selectedTransactions.fetchNextPage()} returnTo={returnTo}/>
        </aside> : null}
      </div>
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
    <fieldset className="home-members">
      <legend id="calendar-member-filter-label" className="sr-only">표시할 구성원</legend>
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
  return (
    <RadioPrimitive.Root
      value={value}
      aria-label={accessibleLabel}
      className={`home-member-option ${selected ? 'is-selected' : ''}`}
    >
      {avatar}
      <span className="max-w-36 whitespace-nowrap" title={label}>{label}</span>
    </RadioPrimitive.Root>
  )
}

function MonthCalendar({ month, days, selectedDate, onSelectDate }: { month: string; days: CalendarDay[]; selectedDate: string; onSelectDate: (date: string) => void }) {
  const { year, monthIndex, dayCount, leadingDays } = calendarMeta(month)
  const values = new Map(days.map((day) => [day.date, day]))
  const cellCount = Math.ceil((leadingDays + dayCount) / 7) * 7
  const today = todayInSeoul()
  return (
    <div className="home-calendar" role="grid" aria-label={`${year}년 ${monthIndex + 1}월 거래 달력`}>
      <div className="grid grid-cols-7 text-left text-[11px] font-medium md:text-xs" role="row">
        {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
          <div className={`px-0.75 pb-3 pt-3 min-[390px]:px-1 md:px-2 ${index === 0 ? 'text-[var(--calendar-income)]' : index === 6 ? 'text-[var(--calendar-expense)]' : 'text-[var(--muted)]'}`} role="columnheader" key={day}>{day}</div>
        ))}
      </div>
      {Array.from({ length: cellCount / 7 }, (_, week) => (
        <div className="grid grid-cols-7 border-t border-[var(--line-subtle)] last:border-b" role="row" key={week}>
          {Array.from({ length: 7 }, (_, weekday) => {
            const day = week * 7 + weekday - leadingDays + 1
            if (day < 1 || day > dayCount) {
              const adjacentDay = new Date(Date.UTC(year, monthIndex, day)).getUTCDate()
              return <div className="border-r border-[var(--line-subtle)] px-0.75 py-3 last:border-r-0 min-[390px]:px-1 md:px-2" role="gridcell" aria-disabled="true" aria-label={`${day < 1 ? '이전' : '다음'} 달 ${adjacentDay}일`} key={`blank-${weekday}`}><span className="flex size-6 items-center justify-center text-sm tabular-nums text-[var(--muted)] opacity-50">{adjacentDay}</span></div>
            }
            const date = `${month}-${String(day).padStart(2, '0')}`
            const value = values.get(date)
            const selected = date === selectedDate
            const dateColor = weekday === 0 ? 'text-[var(--calendar-income)]' : weekday === 6 ? 'text-[var(--calendar-expense)]' : 'text-ink-900 dark:text-white'
            return (
              <div className="min-w-0 border-r border-[var(--line-subtle)] last:border-r-0" role="gridcell" aria-label={calendarCellLabel(date, value)} aria-selected={selected} key={date}>
                <Button
                  type="button"
                  variant="ghost"
                  className="home-calendar-day"
                  aria-label={`${calendarCellLabel(date, value)} 선택`}
                  aria-pressed={selected}
                  onClick={() => onSelectDate(date)}
                >
                  <time
                    className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-xs tabular-nums ${selected ? 'bg-[var(--selection)] font-semibold text-[var(--background)]' : date === today ? 'bg-[var(--surface-selected)] font-semibold text-[var(--foreground)]' : dateColor}`}
                    dateTime={date}
                    aria-current={date === today ? 'date' : undefined}
                  >{day}</time>
                  {value ? (
                    <span className="mt-2 grid w-full min-w-0 gap-0.5 text-[9px] leading-[1.35] tracking-[-.04em] tabular-nums min-[360px]:text-[10px] md:text-[10px]">
                      {value.incomeWon > 0 ? <span className="block whitespace-nowrap text-[var(--calendar-income)]" title={`수입 +${formatWon(value.incomeWon)}`}>+{calendarAmount(value.incomeWon)}</span> : null}
                      {value.expenseWon !== 0 ? <span className="block whitespace-nowrap text-[var(--calendar-expense)]" title={`${value.expenseWon < 0 ? '환불 +' : '지출 -'}${formatWon(value.expenseWon)}`}>{value.expenseWon < 0 ? '+' : '-'}{calendarAmount(value.expenseWon)}</span> : null}
                      {value.cardPaymentWon > 0 ? <span className="grid text-[var(--muted)]" title={`카드 대금 결제 ${formatWon(value.cardPaymentWon)} (수입·지출 합계 제외)`}><span>카드결제</span><span className="whitespace-nowrap">{calendarAmount(value.cardPaymentWon)}</span></span> : null}
                      {value.transactionCount > 0 ? <span className="whitespace-nowrap text-[var(--muted)]" title={`합산 거래 ${value.transactionCount.toLocaleString('ko-KR')}건`}>{value.transactionCount.toLocaleString('ko-KR')}건</span> : null}
                    </span>
                  ) : null}
                </Button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function DayDetailPanel({ date, summary, items, isSummaryPending, isPending, isError, hasNextPage, isFetchingNextPage, onBack, onPrevious, onNext, onRetry, onLoadMore, returnTo }: {
  date: string; summary?: CalendarDay; items: Transaction[]; isSummaryPending: boolean; isPending: boolean; isError: boolean;
  hasNextPage: boolean; isFetchingNextPage: boolean; onBack: () => void; onPrevious: () => void; onNext: () => void;
  onRetry: () => void; onLoadMore: () => void; returnTo: string
}) {
  return <>
    <header className="home-day-heading"><div><p>{date.slice(0,4)}년 {Number(date.slice(5,7))}월</p><h2>{dayTitle(date)}{date === todayInSeoul() ? <span>오늘</span> : null}</h2></div><Button className="home-calendar-back" variant="ghost" size="icon" aria-label="달력으로 돌아가기" onClick={onBack}><CalendarDays size={18}/></Button></header>
    <div className="home-day-navigation"><Button variant="ghost" size="icon" aria-label="이전 날" onClick={onPrevious}><ChevronLeft size={17}/></Button><Button variant="ghost" size="icon" aria-label="다음 날" onClick={onNext}><ChevronRight size={17}/></Button></div>
    <section role="region" aria-label={`${date} 거래 상세`}>
      <dl className="home-day-summary"><div><dt>지출</dt><dd>{isSummaryPending ? '—' : signedWon(summary?.expenseWon ?? 0).replace(/^\+/, '')}</dd></div>{summary?.incomeWon ? <div className="home-day-income"><dt>수입</dt><dd>+{formatWon(summary.incomeWon)}</dd></div> : null}</dl>
      {isError ? <div className="py-5" role="alert"><p>선택한 날짜의 거래를 불러오지 못했어요.</p><Button variant="ghost" onClick={onRetry}>다시 불러오기</Button></div> : null}
      {isPending ? <LoadingRows label="선택한 날짜의 거래를 불러오는 중…"/> : items.length ? <><TransactionList>{items.map(item => <TransactionRow key={item.transactionId} transaction={item} returnTo={returnTo}/>)}</TransactionList>{hasNextPage ? <Button className="mt-4" variant="ghost" disabled={isFetchingNextPage} onClick={onLoadMore}>{isFetchingNextPage ? '불러오는 중…' : '거래 더 보기'}</Button> : null}</> : !isError ? <p className="home-day-empty">이 날짜에 기록한 거래가 없어요.</p> : null}
      <p className="home-day-caption">이체·집계 제외 기록은 합계에서 제외돼요.</p>
    </section>
    <Button asChild variant="ghost" className="home-day-record"><Link to="/transactions/new" state={{returnTo,transactionDate:date}} aria-label={`${dayTitle(date)}에 거래 기록`}><Plus size={16}/>이 날짜에 기록하기</Link></Button>
  </>
}

const PULL_REFRESH_THRESHOLD = 64

function useMobilePullToRefresh(rootRef: RefObject<HTMLElement | null>, enabled: boolean, onRefresh: () => Promise<unknown>) {
  const startY = useRef<number | null>(null)
  const distanceRef = useRef(0)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const mobile = window.matchMedia('(max-width: 767px)')

    const reset = () => {
      startY.current = null
      distanceRef.current = 0
      setDistance(0)
    }
    const start = (event: TouchEvent) => {
      if (!enabled || refreshing || !mobile.matches || window.scrollY > 0 || event.touches.length !== 1) return
      startY.current = event.touches[0].clientY
    }
    const move = (event: TouchEvent) => {
      if (startY.current === null || event.touches.length !== 1) return
      if (window.scrollY > 0) {
        reset()
        return
      }
      const pulled = event.touches[0].clientY - startY.current
      if (pulled <= 0) {
        distanceRef.current = 0
        setDistance(0)
        return
      }
      event.preventDefault()
      const nextDistance = Math.min(84, pulled * 0.45)
      distanceRef.current = nextDistance
      setDistance(nextDistance)
    }
    const finish = () => {
      if (startY.current === null) return
      const shouldRefresh = distanceRef.current >= PULL_REFRESH_THRESHOLD
      reset()
      if (!shouldRefresh) return
      setRefreshing(true)
      void onRefresh().catch(() => undefined).finally(() => setRefreshing(false))
    }

    root.addEventListener('touchstart', start, { passive: true })
    root.addEventListener('touchmove', move, { passive: false })
    root.addEventListener('touchend', finish)
    root.addEventListener('touchcancel', reset)
    return () => {
      root.removeEventListener('touchstart', start)
      root.removeEventListener('touchmove', move)
      root.removeEventListener('touchend', finish)
      root.removeEventListener('touchcancel', reset)
    }
  }, [enabled, onRefresh, refreshing, rootRef])

  return { distance, refreshing }
}

function PullToRefreshIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  const visible = refreshing || distance > 0
  const ready = distance >= PULL_REFRESH_THRESHOLD
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center text-xs font-medium text-[var(--muted)] transition-opacity md:hidden"
      style={{ opacity: visible ? 1 : 0, transform: `translateY(${refreshing ? 12 : Math.max(-24, distance - 28)}px)` }}
      aria-live="polite"
      data-pull-to-refresh
    >
      <span className="inline-flex items-center gap-1.5">
        <RefreshCw className={refreshing ? 'animate-spin' : undefined} size={15} />
        {refreshing ? '새로고침 중…' : ready ? '놓아서 새로고침' : '아래로 당겨 새로고침'}
      </span>
    </div>
  )
}

function TransactionRow({ transaction, returnTo }: { transaction: Transaction; returnTo: string }) {
  const amount = `${transactionRowAmountPrefix(transaction)}${formatWon(transaction.amountWon)}`
  const label = transaction.description || transaction.category?.name || transactionTypeLabel(transaction)
  const categoryLabel = transaction.description ? transaction.category?.name : undefined
  const content = <><div className="min-w-0"><p className="truncate text-sm font-semibold">{label}</p><div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-[var(--muted)]">{categoryLabel ? <><span className="max-w-full break-words font-medium text-[var(--foreground)]">{categoryLabel}</span><span aria-hidden="true">·</span></> : null}<span className="min-w-0 break-words">{postingLabel(transaction)}</span>{transaction.performedBy ? <><span aria-hidden="true">·</span><span className="inline-flex min-w-0 items-center gap-1"><MemberAvatar displayName={transaction.performedBy.displayName} memberId={transaction.performedBy.memberId} size="xs" /><span className="truncate">{transaction.performedBy.displayName}</span></span></> : null}{transaction.installmentCount && transaction.installmentCount > 1 ? <><span aria-hidden="true">·</span><span className="shrink-0">{transaction.installmentCount}개월</span></> : null}{transaction.excludedFromStatistics ? <><span aria-hidden="true">·</span><span className="shrink-0 font-semibold">집계 제외</span></> : null}</div></div><div className="shrink-0 text-right"><strong className="text-sm font-semibold tabular-nums">{amount}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{transactionTypeLabel(transaction)}</span></div></>
  const destination = transactionRowDestination(transaction)
  return <li><TransactionListRow to={destination} returnTo={returnTo} accessibleName={transactionRowAccessibleName(transaction, label, amount)}>{content}</TransactionListRow></li>
}

function LoadingRows({ label }: { label: string }) {
  return <div className="grid min-h-48 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />{label}</span></div>
}

function HomeError({ onRetry }: { onRetry: () => void }) {
  return <div className="ui-empty-state my-6"><p role="alert">가계부 기록을 불러오지 못했어요.</p><Button className="mt-4" variant="secondary" onClick={onRetry}>다시 불러오기</Button></div>
}

function EmptyTransactions() {
  return <div className="ui-empty-state my-6"><p className="font-semibold">이 달에 기록한 거래가 없어요.</p><p className="mt-2 text-sm text-[var(--muted)]">수입, 지출 또는 이체를 기록하면 날짜별로 이어서 볼 수 있어요.</p><Button asChild className="mt-5"><Link to="/transactions/new"><SquarePen size={18} />첫 거래 기록</Link></Button></div>
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
  const navigation = state as { transactionSaved?: boolean; transactionUpdated?: boolean; transactionDeleted?: boolean; prepaymentCancelled?: boolean; automaticSettlementCancelled?: boolean; manualPaymentCancelled?: boolean } | null
  const message = navigation?.transactionSaved ? '거래를 기록했어요.' : navigation?.transactionUpdated ? '거래를 수정했어요.' : navigation?.transactionDeleted ? '거래를 삭제했어요.' : navigation?.automaticSettlementCancelled ? '자동 정산을 삭제하고 결제 계좌와 카드 잔액을 되돌렸어요.' : navigation?.manualPaymentCancelled ? '수동 결제를 취소하고 결제 계좌와 카드 잔액을 되돌렸어요.' : navigation?.prepaymentCancelled ? '선결제를 취소하고 결제 계좌와 카드 잔액을 되돌렸어요.' : undefined
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

function calendarCellLabel(date: string, value?: CalendarDay) {
  const amounts: string[] = []
  if (value && value.incomeWon > 0) amounts.push(`수입 +${formatWon(value.incomeWon)}`)
  if (value && value.expenseWon > 0) amounts.push(`지출 -${formatWon(value.expenseWon)}`)
  if (value && value.expenseWon < 0) amounts.push(`환불 +${formatWon(value.expenseWon)}`)
  if (value && value.cardPaymentWon > 0) amounts.push(`카드 대금 결제 ${formatWon(value.cardPaymentWon)}`)
  if (value && value.transactionCount > 0) amounts.push(`합산 거래 ${value.transactionCount.toLocaleString('ko-KR')}건`)
  return amounts.length ? `${dayTitle(date)}, ${amounts.join(', ')}` : `${dayTitle(date)}, 거래 없음`
}
