import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, UsersRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { PageTitle } from '../../components/ui/PageTitle'
import { RadioGroup, RadioGroupItem } from '../../components/ui/RadioGroup'
import { ApiError } from '../../lib/api'
import { addMonths, currentMonthInSeoul, monthTitle } from '../../lib/month'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { categoryApi, categoryKeys, type Category } from '../categories/api'
import type { LedgerBook } from '../membership/api'
import { StatisticsFilters } from './StatisticsFilters'
import { statisticsApi, statisticsKeys, type MonthlyStatistics } from './api'
import {
  activeStatisticsFilterCount,
  parseStatisticsUrl,
  statisticsFiltersFromUrl,
  statisticsSearchParams,
  type StatisticsDirection,
  type StatisticsUrlState,
} from './filters'
import { categoryChartTone, categoryDonutSlices, categoryShares, formatFlowWon, formatRatio, formatSignedWon, yearlyBarSeries } from './presentation'

export function StatisticsPage({ ledger }: { ledger: LedgerBook }) {
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const [params, setParams] = useSearchParams()
  const currentMonth = currentMonthInSeoul()
  const currentMember = ledger.members.find((member) => member.currentUser) ?? ledger.members[0]!
  const memberIds = new Set(ledger.members.map((member) => member.memberId))
  const urlState = parseStatisticsUrl(params, { currentMonth, currentMemberId: currentMember.memberId, validMemberIds: memberIds })
  const currentSearch = params.toString()
  const canonicalSearch = statisticsSearchParams(urlState, currentMember.memberId).toString()
  const filters = statisticsFiltersFromUrl(urlState)

  useEffect(() => {
    if (currentSearch !== canonicalSearch) setParams(canonicalSearch, { replace: true })
  }, [canonicalSearch, currentSearch, setParams])

  const statistics = useQuery({
    queryKey: statisticsKeys.monthly(filters),
    queryFn: () => statisticsApi.monthly(filters),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && (error.status === 400 || error.status === 404)) && count < 2,
  })
  const [incomeCategories, expenseCategories] = useQueries({ queries: (['INCOME', 'EXPENSE'] as const).map((kind) => ({
    queryKey: categoryKeys.list(kind),
    queryFn: () => categoryApi.list(kind),
    staleTime: 0,
    refetchOnWindowFocus: 'always' as const,
  })) })
  const categories = [...(expenseCategories.data ?? []), ...(incomeCategories.data ?? [])]
  const categoriesPending = incomeCategories.isPending || expenseCategories.isPending
  const categoriesError = incomeCategories.isError || expenseCategories.isError

  function replaceState(next: StatisticsUrlState) {
    setParams(statisticsSearchParams(next, currentMember.memberId), { replace: true })
  }

  function moveMonth(offset: number) {
    replaceState({ ...urlState, month: addMonths(urlState.month, offset) })
  }

  function changeDirection(direction: StatisticsDirection) {
    replaceState({ ...urlState, direction })
  }

  function changeMember(memberKey: string) {
    replaceState({ ...urlState, memberId: memberKey === 'all' ? null : memberKey })
  }

  const activeCount = activeStatisticsFilterCount(urlState)
  const filterSummary = statisticsFilterSummary(urlState, ledger, categories, statistics.data)
  const memberSummary = statisticsMemberSummary(urlState.memberId, ledger)

  return (
    <AppShell ledgerNavigation>
      <section className="py-5 md:py-8 @container">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
          <PageTitle>월간 통계</PageTitle>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" aria-label="최신 통계 확인" onClick={() => queryClient.invalidateQueries({ queryKey: statisticsKeys.all })} disabled={!online}><RefreshCw size={18} /></Button>
            <StatisticsFilters
              state={urlState}
              members={ledger.members}
              categories={categories}
              categoriesPending={categoriesPending}
              categoriesError={categoriesError}
              onRetryCategories={() => { void incomeCategories.refetch(); void expenseCategories.refetch() }}
              onApply={replaceState}
            />
          </div>
        </header>

        <StatisticsMemberFilter
          members={ledger.members}
          currentMemberId={currentMember.memberId}
          value={urlState.memberId ?? 'all'}
          onChange={changeMember}
        />

        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="icon" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></Button>
            <h2 className="whitespace-nowrap text-sm font-medium tabular-nums text-[var(--muted)]" data-month-title>{monthTitle(urlState.month)}</h2>
            <Button type="button" variant="ghost" size="icon" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={18} /></Button>
          </div>
          {urlState.month !== currentMonth ? <div className="text-center"><Button className="min-h-11" type="button" variant="ghost" onClick={() => replaceState({ ...urlState, month: currentMonth })}>이번 달</Button></div> : null}
        </div>

        <p className={activeCount ? 'mt-3 text-center text-sm text-[var(--muted)]' : 'sr-only'} aria-live="polite">{activeCount ? `${memberSummary} 통계 · ${filterSummary} · 세부 필터 ${activeCount}개 적용됨` : `${memberSummary} 통계`}</p>
        {!online ? <p className="mt-4 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">오프라인 상태예요. 화면에 남아 있는 통계는 볼 수 있지만 최신값을 확인할 수 없어요.</p> : null}
        {statistics.isFetching && statistics.data ? <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--muted)]" role="status"><LoaderCircle className="animate-spin" size={16} />최신 통계를 확인하는 중…</p> : null}

        {statistics.isPending ? <StatisticsLoading /> : !statistics.data ? (
          <StatisticsError error={statistics.error} onRetry={() => statistics.refetch()} />
        ) : (
          <StatisticsContent
            statistics={statistics.data}
            direction={urlState.direction}
            onDirectionChange={changeDirection}
            backgroundError={statistics.isError}
            onRetry={() => statistics.refetch()}
            filtered={activeCount > 0}
            onClearFilters={() => replaceState({ ...urlState, owner: 'all', categoryId: null })}
          />
        )}
      </section>
    </AppShell>
  )
}

function StatisticsMemberFilter({ members, currentMemberId, value, onChange }: {
  members: LedgerBook['members']
  currentMemberId: string
  value: string
  onChange: (value: string) => void
}) {
  const orderedMembers = [...members].sort((left, right) => Number(right.currentUser) - Number(left.currentUser))
  return (
    <fieldset className="-mx-4 mt-3 min-w-0 xs:-mx-6 md:mx-0">
      <legend id="statistics-member-filter-label" className="sr-only">통계를 볼 구성원</legend>
      <div className="overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xs:px-6 md:px-0">
        <RadioGroup
          name="statistics-member-filter"
          value={value}
          onValueChange={onChange}
          aria-labelledby="statistics-member-filter-label"
          className="flex w-max min-w-full items-end gap-1"
        >
          {orderedMembers.map((member) => (
            <StatisticsMemberOption
              key={member.memberId}
              value={member.memberId}
              selected={value === member.memberId}
              label={member.currentUser ? '나' : member.displayName}
              accessibleLabel={member.memberId === currentMemberId ? '내 통계 보기' : `${member.displayName} 통계 보기`}
              avatar={<MemberAvatar displayName={member.displayName} memberId={member.memberId} size="xs" />}
            />
          ))}
          <StatisticsMemberOption
            value="all"
            selected={value === 'all'}
            label="모두"
            accessibleLabel="모든 구성원 통계 보기"
            avatar={<UsersRound aria-hidden="true" size={16} />}
          />
        </RadioGroup>
      </div>
    </fieldset>
  )
}

function StatisticsMemberOption({ value, selected, label, accessibleLabel, avatar }: {
  value: string
  selected: boolean
  label: string
  accessibleLabel: string
  avatar: ReactNode
}) {
  const id = `statistics-member-${value}`
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

function StatisticsContent({ statistics, direction, onDirectionChange, backgroundError, onRetry, filtered, onClearFilters }: {
  statistics: MonthlyStatistics
  direction: StatisticsDirection
  onDirectionChange: (direction: StatisticsDirection) => void
  backgroundError: boolean
  onRetry: () => void
  filtered: boolean
  onClearFilters: () => void
}) {
  const directionTotal = direction === 'expense' ? statistics.totals.expenseWon : statistics.totals.incomeWon
  const shares = categoryShares(statistics.categoryBreakdown, direction, directionTotal)
  const noActivity = statistics.totals.incomeWon === 0 && statistics.totals.expenseWon === 0

  return (
    <>
      {backgroundError ? <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-l-4 border-amber-500 px-4 py-2 text-sm" role="status"><span>최신 통계를 확인하지 못했어요. 지금 보이는 결과는 유지했어요.</span><Button type="button" variant="ghost" onClick={onRetry}>다시 확인</Button></div> : null}
      <StatisticsSummary statistics={statistics} />
      {noActivity ? (
        <div className="mt-7 border-y border-[var(--line)] py-8 text-center" role="status">
          <p className="font-semibold">{filtered ? '선택한 조건에 맞는 기록이 없습니다' : '이번 달 수입·지출 기록이 없습니다'}</p>
          {filtered
            ? <Button className="mt-4" type="button" variant="secondary" onClick={onClearFilters}>필터 초기화</Button>
            : <Button className="mt-4" asChild variant="secondary"><Link to="/transactions/new">기록하기</Link></Button>}
        </div>
      ) : null}
      <div className="mt-8 grid gap-10 @min-[54rem]:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)] @min-[54rem]:items-start @min-[54rem]:gap-8">
        <CategoryBreakdown statistics={statistics} direction={direction} shares={shares} onDirectionChange={onDirectionChange} />
        <YearlyTrend statistics={statistics} />
      </div>
    </>
  )
}

function StatisticsSummary({ statistics }: { statistics: MonthlyStatistics }) {
  const values = [
    { label: '수입', value: formatFlowWon(statistics.totals.incomeWon, 'income'), tone: statistics.totals.incomeWon === 0 ? '' : 'text-[var(--income)]' },
    { label: '지출', value: formatFlowWon(statistics.totals.expenseWon, 'expense'), tone: statistics.totals.expenseWon === 0 ? '' : 'text-[var(--expense)]' },
    { label: '순액', value: formatSignedWon(statistics.totals.netWon), tone: '' },
  ]
  return <dl className="mt-6 grid grid-cols-2 border-y border-[var(--line)] @min-[40rem]:grid-cols-3" aria-label="월간 수입 지출 순액 요약">{values.map((item, index) => <div className={`min-w-0 px-1 py-4 text-right xs:px-3 @min-[40rem]:px-5 ${index === 1 ? 'border-l border-[var(--line)]' : ''} ${index === 2 ? 'col-span-2 border-t border-[var(--line)] @min-[40rem]:col-span-1 @min-[40rem]:border-t-0 @min-[40rem]:border-l' : ''}`} key={item.label}><dt className="text-sm text-[var(--muted)]">{item.label}</dt><dd className={`mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold tabular-nums ${index === 2 ? 'text-xl xs:text-2xl' : 'text-lg xs:text-xl'} ${item.tone}`} title={item.value}>{item.value}</dd></div>)}</dl>
}

function CategoryBreakdown({ statistics, direction, shares, onDirectionChange }: { statistics: MonthlyStatistics; direction: StatisticsDirection; shares: ReturnType<typeof categoryShares>; onDirectionChange: (direction: StatisticsDirection) => void }) {
  const [expanded, setExpanded] = useState(false)
  const directionTotal = direction === 'expense' ? statistics.totals.expenseWon : statistics.totals.incomeWon
  const label = direction === 'expense' ? '지출' : '수입'
  const ratiosHidden = shares.length > 0 && shares.some((item) => item.ratioPercent === null)
  const donutSlices = categoryDonutSlices(shares)
  const visibleShares = expanded ? shares : shares.slice(0, 6)
  return (
    <section aria-labelledby="category-breakdown-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div><h2 id="category-breakdown-title" className="text-xl font-semibold">분류 비중</h2><p className="mt-1 text-sm text-[var(--muted)]">환불을 반영한 순금액 기준이에요.</p></div>
        <div className="flex" role="group" aria-label="분류 비중 방향">
          <DirectionButton active={direction === 'expense'} onClick={() => onDirectionChange('expense')}>지출</DirectionButton>
          <DirectionButton active={direction === 'income'} onClick={() => onDirectionChange('income')}>수입</DirectionButton>
        </div>
      </div>
      <p className="mt-4 text-sm"><span className="text-[var(--muted)]">{label} 순합계 </span><strong className="tabular-nums">{formatFlowWon(directionTotal, direction)}</strong></p>
      {donutSlices.length ? <CategoryDonut label={label} categoryCount={shares.length} slices={donutSlices} /> : null}
      {shares.length ? (
        <ol id={`category-breakdown-${direction}`} className="mt-3 divide-y divide-[var(--line-subtle)] border-y border-[var(--line)]" aria-label={`${label} 분류 비중`}>
          {visibleShares.map((item) => {
            const sliceIndex = donutSlices.findIndex((slice) => slice.categoryIds.includes(item.categoryId))
            return <li className="py-3" key={item.categoryId} data-category-id={item.categoryId}>
              <div className="flex items-baseline justify-between gap-4 text-sm"><span className="flex min-w-0 items-center gap-2 break-words font-semibold">{sliceIndex >= 0 ? <CategoryTone index={sliceIndex} /> : null}{item.categoryName}</span><span className="shrink-0 text-right tabular-nums"><strong>{formatFlowWon(item.amountWon, direction)}</strong>{item.ratioPercent === null ? null : <span className="ml-2 text-xs text-[var(--muted)]">{formatRatio(item.ratioPercent)}</span>}</span></div>
              {item.barPercent === null ? null : <div className="mt-2 h-1 overflow-hidden bg-[var(--line-subtle)]" aria-hidden="true"><div className={direction === 'expense' ? 'h-full bg-[var(--expense)]' : 'h-full bg-[var(--income)]'} style={{ width: `${item.barPercent}%` }} /></div>}
            </li>
          })}
        </ol>
      ) : <p className="mt-4 border-y border-[var(--line)] py-6 text-sm text-[var(--muted)]">이번 달 {label}이 없습니다</p>}
      {shares.length > 6 ? <Button className="mt-3" type="button" variant="ghost" aria-expanded={expanded} aria-controls={`category-breakdown-${direction}`} onClick={() => setExpanded((current) => !current)}>{expanded ? '상위 6개만 보기' : `전체 ${shares.length}개 보기`}</Button> : null}
      {ratiosHidden ? <p className="mt-3 text-sm text-[var(--muted)]" role="status">환불을 반영해 비율 대신 분류별 순금액을 보여드려요</p> : null}
    </section>
  )
}

function CategoryDonut({ label, categoryCount, slices }: {
  label: string
  categoryCount: number
  slices: ReturnType<typeof categoryDonutSlices>
}) {
  return (
    <figure className="mt-3 flex justify-center py-2" role="img" aria-label={`${label} 분류 비중 원형 차트`}>
      <div className="relative size-36 xs:size-40">
        <svg className="size-full" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle cx="50" cy="50" r="38" fill="none" stroke="var(--line-subtle)" strokeWidth="14" />
          {slices.map((slice, index) => (
            <circle
              data-category-donut-slice
              key={slice.key}
              cx="50"
              cy="50"
              r="38"
              fill="none"
              pathLength="100"
              stroke={categoryChartTone(index)}
              strokeDasharray={`${slice.normalizedPercent} ${100 - slice.normalizedPercent}`}
              strokeDashoffset={-slice.offsetPercent}
              strokeWidth="14"
              transform="rotate(-90 50 50)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <span className="pointer-events-none absolute inset-0 grid place-content-center text-center" aria-hidden="true"><span className="text-xs text-[var(--muted)]">{label}</span><strong className="mt-0.5 text-sm">분류 {categoryCount}개</strong></span>
      </div>
    </figure>
  )
}

function CategoryTone({ index }: { index: number }) {
  return <span data-category-tone className="size-2 shrink-0 rounded-full" aria-hidden="true" style={{ backgroundColor: categoryChartTone(index) }} />
}

function DirectionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button variant="ghost" className={`rounded-none border-b-2 px-3 ${active ? 'border-forest-700 text-forest-800 dark:border-forest-100 dark:text-white' : 'border-transparent text-[var(--muted)] hover:text-ink-900 dark:hover:text-white'}`} type="button" aria-pressed={active} onClick={onClick}>{children}</Button>
}

function YearlyTrend({ statistics }: { statistics: MonthlyStatistics }) {
  const bars = yearlyBarSeries(statistics.yearlyTrend)
  const year = statistics.month.slice(0, 4)
  const hasActivity = bars.some((month) => month.incomeWon !== 0 || month.expenseWon !== 0)
  return (
    <section className="@min-[54rem]:border-l @min-[54rem]:border-[var(--line)] @min-[54rem]:pl-8" aria-labelledby="yearly-trend-title">
      <div className="border-b border-[var(--line)] pb-3"><h2 id="yearly-trend-title" className="text-xl font-semibold">{year}년 월별 합계</h2><p className="mt-1 text-sm text-[var(--muted)]">한 해의 수입과 지출을 월별로 비교해요.</p></div>
      {hasActivity ? (
        <>
          <div className="mt-4 flex flex-wrap gap-4 text-xs"><span className="inline-flex items-center gap-2"><span className="size-2.5 bg-[var(--income)]" aria-hidden="true" />수입</span><span className="inline-flex items-center gap-2"><span className="size-2.5 bg-[var(--expense)]" aria-hidden="true" />지출</span></div>
          <figure className="mt-4" role="img" aria-label={`${year}년 월별 수입 지출 막대그래프`}>
            <div className="relative h-48 border-b border-[var(--line)]" aria-hidden="true">
              <span className="absolute inset-x-0 top-1/4 border-t border-dashed border-[var(--line-subtle)]" />
              <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--line-subtle)]" />
              <span className="absolute inset-x-0 top-3/4 border-t border-dashed border-[var(--line-subtle)]" />
              <ol className="relative grid h-full grid-cols-12 items-end gap-1">
                {bars.map((month) => (
                  <li className="flex h-full min-w-0 items-end justify-center gap-px" data-month-bar-group={month.month} key={month.month}>
                    <span
                      className="w-[36%] max-w-3 bg-[var(--income)]"
                      data-income-bar
                      style={{ height: `${month.incomePercent}%`, minHeight: month.incomeWon === 0 ? undefined : '2px' }}
                      title={`${monthNumber(month.month)}월 수입 ${formatFlowWon(month.incomeWon, 'income')}`}
                    />
                    <span
                      className="w-[36%] max-w-3 bg-[var(--expense)]"
                      data-expense-bar
                      style={{ height: `${month.expensePercent}%`, minHeight: month.expenseWon === 0 ? undefined : '2px' }}
                      title={`${monthNumber(month.month)}월 지출 ${formatFlowWon(month.expenseWon, 'expense')}`}
                    />
                  </li>
                ))}
              </ol>
            </div>
            <ol className="mt-2 grid grid-cols-12 gap-1" aria-hidden="true">
              {bars.map((month) => <li className={`min-w-0 text-center text-xs tabular-nums ${month.month === statistics.month ? 'font-semibold text-forest-700 dark:text-forest-100' : 'text-[var(--muted)]'}`} key={month.month}>{monthNumber(month.month)}월</li>)}
            </ol>
          </figure>
          <details className="mt-5 border-y border-[var(--line)]">
            <summary className="flex min-h-11 cursor-pointer items-center py-3 text-base font-semibold">월별 금액 목록</summary>
            <ol className="divide-y divide-[var(--line-subtle)] border-t border-[var(--line)]" aria-label={`${year}년 월별 금액 목록`}>
              {bars.map((month) => (
                <li className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 py-3 text-sm" key={month.month}>
                  <time className={month.month === statistics.month ? 'font-semibold text-forest-700 dark:text-forest-100' : 'font-semibold'} dateTime={month.month} aria-current={month.month === statistics.month ? 'date' : undefined}>{monthNumber(month.month)}월</time>
                  <dl className="grid grid-cols-2 gap-3">
                    <FlowValue label="수입" value={formatFlowWon(month.incomeWon, 'income')} tone={month.incomeWon === 0 ? '' : 'text-[var(--income)]'} />
                    <FlowValue label="지출" value={formatFlowWon(month.expenseWon, 'expense')} tone={month.expenseWon === 0 ? '' : 'text-[var(--expense)]'} />
                  </dl>
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : <p className="mt-4 border-y border-[var(--line)] py-6 text-sm text-[var(--muted)]">{year}년에는 수입·지출 기록이 없습니다</p>}
    </section>
  )
}

function FlowValue({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className="min-w-0 text-right"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className={`mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-semibold tabular-nums ${tone}`} title={value}>{value}</dd></div>
}

function StatisticsLoading() {
  return (
    <div className="mt-6 min-h-[28rem] animate-pulse" role="status" aria-busy="true">
      <p className="sr-only">월간 통계를 계산하는 중…</p>
      <div className="grid grid-cols-2 border-y border-[var(--line)] @min-[40rem]:grid-cols-3">
        {[0, 1, 2].map((index) => <div className={`h-24 px-3 py-4 ${index === 1 ? 'border-l border-[var(--line)]' : ''} ${index === 2 ? 'col-span-2 border-t border-[var(--line)] @min-[40rem]:col-span-1 @min-[40rem]:border-t-0 @min-[40rem]:border-l' : ''}`} key={index}><span className="ml-auto block h-3 w-12 bg-[var(--line)]" /><span className="mt-3 ml-auto block h-6 w-28 max-w-full bg-[var(--line)]" /></div>)}
      </div>
      <div className="mt-8 grid gap-8 @min-[54rem]:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]"><div className="space-y-3">{[0, 1, 2, 3].map((item) => <span className="block h-12 bg-[var(--line-subtle)]" key={item} />)}</div><div className="h-64 bg-[var(--line-subtle)]" /></div>
    </div>
  )
}

function StatisticsError({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const message = error instanceof ApiError && error.status === 404 ? '선택한 필터를 찾을 수 없어요. 필터를 다시 확인해 주세요.' : error?.message ?? '월간 통계를 불러오지 못했어요.'
  return <div className="mt-7 border-y border-[var(--line)] py-8 text-center"><p role="alert">{message}</p><Button className="mt-4" type="button" variant="secondary" onClick={onRetry}><RefreshCw size={17} />다시 불러오기</Button></div>
}

function statisticsFilterSummary(state: StatisticsUrlState, ledger: LedgerBook, categories: Category[], statistics?: MonthlyStatistics) {
  const labels: string[] = []
  if (state.owner === 'joint') labels.push('공동 소유 자산')
  else if (state.owner.startsWith('member:')) labels.push(`${memberName(state.owner.slice('member:'.length), ledger)} 소유 자산`)
  if (state.categoryId) {
    const categoryName = categories.find((category) => category.categoryId === state.categoryId)?.name
      ?? statistics?.categoryBreakdown.find((category) => category.categoryId === state.categoryId)?.categoryName
      ?? '선택한 분류'
    labels.push(categoryName)
  }
  return labels.join(' · ')
}

function statisticsMemberSummary(memberId: string | null, ledger: LedgerBook) {
  if (memberId === null) return '모든 구성원'
  const member = ledger.members.find((item) => item.memberId === memberId)
  return member?.currentUser ? '내' : `${member?.displayName ?? '선택한 구성원'}의`
}

function memberName(memberId: string, ledger: LedgerBook) {
  const member = ledger.members.find((item) => item.memberId === memberId)
  return member ? `${member.displayName}${member.currentUser ? ' (나)' : ''}` : '선택한 구성원'
}

function monthNumber(month: string) {
  return Number(month.slice(5, 7))
}
