import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Link2, LoaderCircle, Plus, RefreshCw, SquarePen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { addMonths, currentMonthInSeoul, monthBounds, monthTitle } from '../../lib/month'
import {
  membershipApi,
  membershipKeys,
  type CurrentLedgerBook,
} from '../membership/api'
import type { LedgerNavigationState } from '../membership/ledgerLifecycle'
import { transactionApi, transactionKeys, type Transaction } from '../transactions/api'
import { transactionRowAccessibleName, transactionRowAmountPrefix, transactionRowDestination, transactionRowTone, transactionTypeLabel } from '../transactions/transactionRow'

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : '요청을 처리하지 못했어요.'}</p>
}

export function HomePage({ current }: { current: CurrentLedgerBook }) {
  return (
    <AppShell ledgerNavigation={Boolean(current.ledger)}>
      {current.ledger ? <LedgerHome /> : <LedgerSetup />}
    </AppShell>
  )
}

function LedgerSetup() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const createLedger = useMutation({
    mutationFn: membershipApi.createLedger,
    onSuccess: (ledger) => queryClient.setQueryData(membershipKeys.current, { ledger }),
  })

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createLedger.mutate()
  }

  function openInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = code.trim()
    if (normalized) navigate(`/join?code=${encodeURIComponent(normalized)}`)
  }

  return (
    <section className="py-8 md:py-14">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-brass-500">첫 시작</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.035em] md:text-4xl">함께 기록할 가계부를 준비해요</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">가계부를 바로 시작하거나 받은 초대 코드로 기존 공동 기록에 참여할 수 있어요. 로그인 아이디는 초대에 사용하거나 다른 구성원에게 공개하지 않아요.</p>
        {ledgerLifecycleStatus(location.state)}
      </div>

      <div className="mt-8 grid divide-y divide-[var(--line)] border-y border-[var(--line)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <form className="flex flex-col px-1 py-6 xs:px-5 lg:px-7" onSubmit={create}>
          <Plus className="text-forest-700" size={24} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">가계부 시작하기</h2>
          <p className="mt-2 min-h-12 text-sm leading-6 text-[var(--muted)]">별도 설정 없이 바로 시작해요. 모든 구성원이 같은 권한으로 함께 관리할 수 있어요.</p>
          {createLedger.error ? <div className="mt-5"><ErrorNotice error={createLedger.error} /></div> : null}
          <div className="mt-auto pt-5">
            <Button type="submit" className="w-full" size="large" disabled={createLedger.isPending}>
              {createLedger.isPending && <LoaderCircle className="animate-spin" size={18} />}가계부 시작하기
            </Button>
          </div>
        </form>

        <form className="px-1 py-6 xs:px-5 lg:px-7" onSubmit={openInvitation}>
          <Link2 className="text-forest-700" size={24} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">초대 코드로 참여하기</h2>
          <p className="mt-2 min-h-12 text-sm leading-6 text-[var(--muted)]">코드를 확인한 뒤 현재 구성원을 보고 참여를 결정할 수 있어요.</p>
          <div className="mt-5">
            <Field id="invitationCode" name="invitationCode" label="초대 코드" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required />
          </div>
          <Button type="submit" className="mt-5 w-full" variant="secondary" size="large" disabled={!code.trim()}>초대 확인하기</Button>
        </form>
      </div>
    </section>
  )
}

function LedgerHome() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : currentMonthInSeoul()
  const view = params.get('view') === 'daily' ? 'daily' : 'calendar'
  const bounds = monthBounds(month)
  const calendar = useQuery({
    queryKey: transactionKeys.calendar(month),
    queryFn: () => transactionApi.calendar(month),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const transactions = useInfiniteQuery({
    queryKey: transactionKeys.list(bounds.from, bounds.toExclusive),
    queryFn: ({ pageParam }) => transactionApi.list({ from: bounds.from, toExclusive: bounds.toExclusive, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: view === 'daily',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const loadMore = useRef<HTMLDivElement>(null)
  const items = useMemo(() => transactions.data?.pages.flatMap((page) => page.items) ?? [], [transactions.data])
  const groups = useMemo(() => groupTransactions(items), [items])
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
      return updated
    })
  }

  function changeView(nextView: 'calendar' | 'daily') {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('month', month)
      updated.set('view', nextView)
      return updated
    }, { replace: true })
  }

  return (
    <section className="max-w-5xl py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <h1 className="text-2xl font-semibold tracking-[-.025em]">가계부</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="최신 거래 확인" onClick={() => queryClient.invalidateQueries({ queryKey: transactionKeys.all })}><RefreshCw size={18} /></Button>
          <Button asChild><Link to="/transactions/new"><SquarePen size={18} />기록</Link></Button>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={20} /></Button>
        <h2 className="text-xl font-semibold tabular-nums">{monthTitle(month)}</h2>
        <Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={20} /></Button>
      </div>

      {transactionStatus(location.state)}
      {ledgerLifecycleStatus(location.state)}

      <div className="mt-4 grid grid-cols-3 border-y border-[var(--line)] py-3 text-center">
        <SummaryValue label="수입" value={calendar.data?.totalIncomeWon} tone="income" />
        <SummaryValue label="지출" value={calendar.data?.totalExpenseWon} tone="expense" />
        <SummaryValue label="순액" value={calendar.data?.netWon} tone="net" />
      </div>

      <div className="mt-5 flex border-b border-[var(--line)]" role="group" aria-label="가계부 보기 방식">
        <ViewButton active={view === 'calendar'} onClick={() => changeView('calendar')}>월간 달력</ViewButton>
        <ViewButton active={view === 'daily'} onClick={() => changeView('daily')}>일별 보기</ViewButton>
      </div>

      {view === 'daily' && calendar.isError ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3 text-sm"><p role="alert">월 합계를 불러오지 못했어요. 일별 거래는 계속 볼 수 있어요.</p><Button variant="ghost" onClick={() => calendar.refetch()}>합계 다시 불러오기</Button></div> : null}

      {view === 'calendar' ? (
        calendar.isPending ? <LoadingRows label="달력을 불러오는 중…" /> : calendar.isError ? <HomeError onRetry={() => calendar.refetch()} /> : <MonthCalendar month={month} days={calendar.data?.days ?? []} />
      ) : transactions.isPending ? <LoadingRows label="거래를 불러오는 중…" /> : transactions.isError ? <HomeError onRetry={() => transactions.refetch()} /> : groups.length ? (
        <div className="mt-2">
          {groups.map((group) => <DayTransactions key={group.date} date={group.date} items={group.items} returnTo={`${location.pathname}${location.search}`} />)}
          <div ref={loadMore} className="grid min-h-16 place-items-center">
            {transactions.isFetchingNextPage ? <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle className="animate-spin" size={17} />다음 거래를 불러오는 중…</span> : transactions.hasNextPage ? <Button variant="ghost" onClick={() => transactions.fetchNextPage()}>거래 더 보기</Button> : <p className="text-xs text-[var(--muted)]">이 달의 거래를 모두 확인했어요.</p>}
          </div>
        </div>
      ) : <EmptyTransactions />}
    </section>
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
  return <dl className="min-w-0 border-r border-[var(--line)] px-2 last:border-r-0"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className={`mt-1 truncate text-sm font-semibold tabular-nums xs:text-base ${color}`} title={shown}>{shown}</dd></dl>
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button variant="ghost" className={`rounded-none border-b-2 px-4 ${active ? 'border-forest-700 text-forest-800 dark:border-forest-100 dark:text-white' : 'border-transparent text-[var(--muted)] hover:text-ink-900 dark:hover:text-white'}`} type="button" aria-pressed={active} onClick={onClick}>{children}</Button>
}

function MonthCalendar({ month, days }: { month: string; days: { date: string; incomeWon: number; expenseWon: number }[] }) {
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
            <div className="min-h-20 min-w-0 border-r border-b border-[var(--line)] p-1.5 last:border-r-0 md:min-h-24 md:p-2 lg:min-h-28" role="gridcell" aria-label={calendarCellLabel(date, value)} key={date}>
              <time className={`block text-xs tabular-nums ${date === today ? 'font-bold text-forest-700 underline decoration-2 underline-offset-4 dark:text-forest-100' : ''}`} dateTime={date}>{day}</time>
              {value && (value.incomeWon !== 0 || value.expenseWon !== 0) ? <div className="mt-2 grid gap-1 overflow-hidden text-xs font-semibold tabular-nums">{value.incomeWon > 0 ? <span className="truncate text-[var(--income)]" title={`수입 +${formatWon(value.incomeWon)}`}>+{compactWon(value.incomeWon)}</span> : null}{value.expenseWon > 0 ? <span className="truncate text-[var(--expense)]" title={`지출 -${formatWon(value.expenseWon)}`}>-{compactWon(value.expenseWon)}</span> : value.expenseWon < 0 ? <span className="truncate text-[var(--transfer)]" title={`환불 +${formatWon(value.expenseWon)}`}>+{compactWon(value.expenseWon)}</span> : null}</div> : null}
            </div>
          )
        })}
      </div>
    </div>
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
  const content = <><div className="min-w-0"><p className="truncate text-sm font-semibold">{label}</p><p className="mt-1 truncate text-xs text-[var(--muted)]">{postingLabel(transaction)}{transaction.performedBy ? ` · ${transaction.performedBy.displayName}` : ''}{transaction.installmentCount && transaction.installmentCount > 1 ? ` · ${transaction.installmentCount}개월` : ''}</p></div><div className="text-right"><strong className={`text-sm font-semibold tabular-nums ${tone}`}>{amount}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{transactionTypeLabel(transaction)}</span></div></>
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

function todayInSeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) }
function dayTitle(date: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T00:00:00+09:00`)) }
function calendarMeta(month: string) { const [year, value] = month.split('-').map(Number); return { year, monthIndex: value - 1, dayCount: new Date(Date.UTC(year, value, 0)).getUTCDate(), leadingDays: new Date(Date.UTC(year, value - 1, 1)).getUTCDay() } }
function formatWon(value: number) { return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원` }
function signedWon(value: number) { return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatWon(value)}` }

function compactWon(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${trimDecimal(absolute / 100_000_000)}억`
  if (absolute >= 10_000) return `${trimDecimal(absolute / 10_000)}만`
  return new Intl.NumberFormat('ko-KR').format(absolute)
}

function trimDecimal(value: number) { return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '') }
function calendarCellLabel(date: string, value?: { incomeWon: number; expenseWon: number }) {
  const amounts: string[] = []
  if (value && value.incomeWon > 0) amounts.push(`수입 +${formatWon(value.incomeWon)}`)
  if (value && value.expenseWon > 0) amounts.push(`지출 -${formatWon(value.expenseWon)}`)
  if (value && value.expenseWon < 0) amounts.push(`환불 +${formatWon(value.expenseWon)}`)
  return amounts.length ? `${dayTitle(date)}, ${amounts.join(', ')}` : `${dayTitle(date)}, 거래 없음`
}
