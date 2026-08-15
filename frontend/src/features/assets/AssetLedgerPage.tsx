import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { LoaderCircle, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { JointAvatar, MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { ApiError } from '../../lib/api'
import type { LedgerBook } from '../membership/api'
import { transactionApi, transactionKeys, type Transaction } from '../transactions/api'
import { transactionRowDestination, transactionTypeLabel } from '../transactions/transactionRow'
import { assetApi, assetKeys, type Asset } from './api'
import { formatDate, formatWon } from './format'

export function AssetLedgerPage({ ledger }: { ledger: LedgerBook }) {
  const { assetId = '' } = useParams()
  const location = useLocation()
  const asset = useQuery({
    queryKey: assetKeys.detail(assetId),
    queryFn: () => assetApi.detail(assetId),
    enabled: Boolean(assetId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const transactions = useInfiniteQuery({
    queryKey: transactionKeys.assetList(assetId),
    queryFn: ({ pageParam }) => transactionApi.listForAsset({ assetId, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(assetId) && !asset.isError,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = transactions
  const items = useMemo(() => transactions.data?.pages.flatMap((page) => page.items) ?? [], [transactions.data])
  const groups = useMemo(() => groupTransactionsByMonth(items), [items])
  const loadMore = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const target = loadMore.current
    if (!target || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
    }, { rootMargin: '240px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  if (asset.isPending) return <AppShell ledgerNavigation><LoadingState label="자산 거래를 준비하는 중…" /></AppShell>
  if (asset.isError || !asset.data) {
    const missing = asset.error instanceof ApiError && asset.error.status === 404
    return <AppShell ledgerNavigation><section className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">{missing ? '자산을 찾을 수 없어요' : '자산을 불러오지 못했어요'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{missing ? '다른 구성원이 자산을 완전히 삭제했거나 주소가 올바르지 않을 수 있어요.' : '연결을 확인한 뒤 다시 시도해 주세요.'}</p>{missing ? <Button asChild className="mt-5"><Link to="/assets">자산 목록</Link></Button> : <Button className="mt-5" variant="secondary" onClick={() => asset.refetch()}>다시 불러오기</Button>}</section></AppShell>
  }

  const currentAsset = asset.data
  const owner = ownerPresentation(currentAsset, ledger)
  const editAction = currentAsset.status === 'ACTIVE' ? <Button asChild size="icon" variant="ghost"><Link to={`/assets/${assetId}/edit`} aria-label="자산 편집"><Settings size={20} /></Link></Button> : null
  const deleted = Boolean((location.state as { transactionDeleted?: boolean } | null)?.transactionDeleted)

  return (
    <AppShell
      ledgerNavigation
      mobileHeader={{ title: currentAsset.name, backTo: '/assets', backLabel: '자산 목록으로', action: editAction }}
    >
      <section className="mx-auto max-w-[52rem] py-4 md:py-8">
        <header className="border-b border-[var(--line)] pb-5">
          <div className="hidden items-start justify-between gap-4 md:flex">
            <div className="min-w-0"><p className="text-sm text-[var(--muted)]">{currentAsset.assetTypeName}{currentAsset.status === 'ARCHIVED' ? ' · 보관됨' : ''}</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-[-.025em]">{currentAsset.name}</h1></div>
            {editAction}
          </div>
          <div className="flex items-end justify-between gap-4 md:mt-5">
            <div className="min-w-0 md:hidden"><p className="text-xs text-[var(--muted)]">{currentAsset.assetTypeName}{currentAsset.status === 'ARCHIVED' ? ' · 보관됨' : ''}</p></div>
            <dl className="ml-auto text-right"><dt className="text-xs text-[var(--muted)]">현재 잔액</dt><dd className={`mt-1 text-2xl font-semibold tracking-[-.035em] tabular-nums md:text-3xl ${currentAsset.currentBalanceWon < 0 ? 'text-[var(--expense)]' : 'text-forest-800 dark:text-forest-100'}`}>{formatWon(currentAsset.currentBalanceWon)}</dd></dl>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">{owner.avatar}<span>{owner.label}</span><span aria-hidden="true">·</span><span>잔액 기준일 {formatDate(currentAsset.openedOn)}</span></div>
          {currentAsset.behavior === 'CREDIT_CARD' ? <dl className="mt-4 grid grid-cols-2 divide-x divide-[var(--line-subtle)] border-t border-[var(--line-subtle)] pt-3 text-sm"><div className="pr-4"><dt className="text-xs text-[var(--muted)]">이번 달 결제 예정</dt><dd className="mt-1 font-semibold tabular-nums">{formatWon(currentAsset.currentMonthCardPaymentDueWon)}</dd></div><div className="pl-4 text-right"><dt className="text-xs text-[var(--muted)]">다음 달 결제 예정</dt><dd className="mt-1 font-semibold tabular-nums">{formatWon(currentAsset.nextMonthCardPaymentDueWon)}</dd></div></dl> : null}
        </header>

        {deleted ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">거래를 삭제했어요.</p> : null}

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2"><h2 className="text-lg font-semibold">거래 내역</h2>{items.length ? <span className="text-xs text-[var(--muted)]">최신순</span> : null}</div>
          {transactions.isPending ? <LoadingState label="거래 내역을 불러오는 중…" /> : transactions.isError && !transactions.data ? <div className="py-12 text-center"><p role="alert">거래 내역을 불러오지 못했어요.</p><Button className="mt-4" variant="secondary" onClick={() => transactions.refetch()}>다시 불러오기</Button></div> : groups.length ? (
            <div>
              {groups.map((group) => <AssetMonthGroup key={group.month} month={group.month} items={group.items} asset={currentAsset} returnTo={`/assets/${assetId}`} />)}
              <div ref={loadMore} className="grid min-h-16 place-items-center">
                {transactions.hasNextPage ? <Button type="button" variant="ghost" disabled={transactions.isFetchingNextPage} onClick={() => transactions.fetchNextPage()}>{transactions.isFetchingNextPage ? <><LoaderCircle className="animate-spin" size={17} />불러오는 중…</> : '이전 거래 더 보기'}</Button> : <p className="text-xs text-[var(--muted)]">모든 거래를 확인했어요.</p>}
              </div>
            </div>
          ) : <div className="py-14 text-center"><p className="font-semibold">이 자산에 기록된 거래가 없어요.</p><p className="mt-2 text-sm text-[var(--muted)]">수입·지출·이체를 기록하면 이곳에 최신순으로 보여요.</p>{currentAsset.status === 'ACTIVE' ? <Button asChild className="mt-5"><Link to="/transactions/new" state={{ returnTo: `/assets/${assetId}` }}>거래 기록하기</Link></Button> : null}</div>}
        </div>
      </section>
    </AppShell>
  )
}

function AssetMonthGroup({ month, items, asset, returnTo }: { month: string; items: Transaction[]; asset: Asset; returnTo: string }) {
  return (
    <section aria-labelledby={`asset-month-${month}`}>
      <h3 id={`asset-month-${month}`} className="border-b border-[var(--line-subtle)] bg-cream-100 py-2 text-sm font-semibold tabular-nums dark:bg-[#101714]">{monthLabel(month)}</h3>
      <ul>{items.map((transaction) => <AssetTransactionRow key={transaction.transactionId} transaction={transaction} asset={asset} returnTo={returnTo} />)}</ul>
    </section>
  )
}

function AssetTransactionRow({ transaction, asset, returnTo }: { transaction: Transaction; asset: Asset; returnTo: string }) {
  const delta = transactionDeltaForAsset(transaction, asset.assetId)
  const type = transactionTypeLabel(transaction)
  const label = transaction.description || transaction.category?.name || type
  const flow = transactionFlow(transaction, asset.assetId)
  const destination = transactionRowDestination(transaction)
  return (
    <li className="border-b border-[var(--line-subtle)]">
      <Link to={destination} state={{ returnTo }} className="grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 transition-colors hover:bg-forest-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)] dark:hover:bg-forest-800 md:px-2" aria-label={`${label} 거래 상세, ${type} ${signedWon(delta)}`}>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{label}</span><span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]"><time className="shrink-0 tabular-nums" dateTime={transaction.occurredOn}>{dayLabel(transaction.occurredOn)}</time><span aria-hidden="true">·</span><span className="truncate">{flow}</span>{transaction.excludedFromStatistics ? <><span aria-hidden="true">·</span><span className="shrink-0 font-semibold">집계 제외</span></> : null}</span></span>
        <span className="text-right"><strong className={`block text-sm font-semibold tabular-nums ${delta < 0 ? 'text-[var(--expense)]' : delta > 0 ? 'text-[var(--income)]' : 'text-[var(--transfer)]'}`}>{signedWon(delta)}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{type}</span></span>
      </Link>
    </li>
  )
}

function ownerPresentation(asset: Asset, ledger: LedgerBook) {
  if (asset.ownershipScope === 'JOINT') return { label: '공동 소유', avatar: <JointAvatar size="xs" /> }
  const member = ledger.members.find((item) => item.memberId === asset.ownerMemberId)
  const name = member?.displayName ?? '구성원'
  return { label: member?.currentUser ? '내 자산' : `${name} 소유`, avatar: <MemberAvatar displayName={name} memberId={member?.memberId ?? asset.assetId} size="xs" /> }
}

function groupTransactionsByMonth(items: Transaction[]) {
  const groups = new Map<string, Transaction[]>()
  for (const item of items) {
    const month = item.occurredOn.slice(0, 7)
    const group = groups.get(month)
    if (group) group.push(item)
    else groups.set(month, [item])
  }
  return [...groups].map(([month, groupedItems]) => ({ month, items: groupedItems }))
}

function transactionDeltaForAsset(transaction: Transaction, assetId: string) {
  const posting = transaction.postings.find((item) => item.assetId === assetId)
  if (posting) return posting.deltaWon
  if (transaction.asset?.assetId === assetId) {
    if (transaction.managementType === 'CARD_REFUND' || transaction.type === 'INCOME') return transaction.amountWon
    if (transaction.type === 'EXPENSE') return -transaction.amountWon
  }
  return 0
}

function transactionFlow(transaction: Transaction, assetId: string) {
  if (transaction.type === 'TRANSFER') {
    const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetName
    const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetName
    return source && destination ? `${source} → ${destination}` : '자산 이체'
  }
  const values = [transaction.category?.name]
  if (transaction.asset && transaction.asset.assetId !== assetId) values.push(transaction.asset.name)
  if (transaction.performedBy) values.push(transaction.performedBy.displayName)
  return values.filter(Boolean).join(' · ') || '자산 반영'
}

function monthLabel(month: string) { const [year, value] = month.split('-'); return `${year}년 ${Number(value)}월` }
function dayLabel(date: string) { return new Intl.DateTimeFormat('ko-KR', { day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T00:00:00+09:00`)) }
function signedWon(value: number) { return `${value > 0 ? '+' : ''}${formatWon(value)}` }
function LoadingState({ label }: { label: string }) { return <div className="grid min-h-56 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />{label}</span></div> }
