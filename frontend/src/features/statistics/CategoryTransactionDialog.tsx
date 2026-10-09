import { useInfiniteQuery } from '@tanstack/react-query'
import { LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { formatDate, formatWon } from '../assets/format'
import { monthTitle } from '../../lib/month'
import { statisticsApi, statisticsKeys, type StatisticsCategoryAmount, type StatisticsFilters } from './api'

type Props = {
  category: StatisticsCategoryAmount | null
  filters: StatisticsFilters
  returnTo: string
  onOpenChange: (open: boolean) => void
}

export function CategoryTransactionDialog({ category, filters, returnTo, onOpenChange }: Props) {
  const transactions = useInfiniteQuery({
    queryKey: statisticsKeys.categoryTransactions(filters, category?.categoryId ?? ''),
    queryFn: ({ pageParam }) => statisticsApi.categoryTransactions({
      filters,
      categoryId: category!.categoryId,
      cursor: pageParam,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(category),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const items = transactions.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Dialog open={Boolean(category)} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 p-0 shadow-none md:left-1/2 md:top-1/2 md:h-[min(44rem,calc(100dvh-3rem))] md:max-h-[calc(100dvh-3rem)] md:w-[min(40rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:shadow-lg sm:p-0">
        <header className="flex shrink-0 items-start justify-between gap-3  px-4 py-4 xs:px-6">
          <div className="min-w-0"><DialogTitle>{category ? `${category.categoryName} 거래 내역` : '분류 거래 내역'}</DialogTitle><DialogDescription className="mt-1">{monthTitle(filters.month)} 통계에 포함된 거래만 보여드려요.</DialogDescription></div>
          <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="거래 내역 닫기" onClick={() => onOpenChange(false)}><X size={18} /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] xs:px-6">
          {transactions.isPending ? (
            <div className="grid min-h-48 place-items-center text-sm text-[var(--muted)]" role="status"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />거래 내역을 불러오는 중…</span></div>
          ) : transactions.isError && !transactions.data ? (
            <div className="py-12 text-center"><p role="alert">거래 내역을 불러오지 못했어요.</p><Button className="mt-4" type="button" variant="secondary" onClick={() => transactions.refetch()}><RefreshCw size={17} />다시 불러오기</Button></div>
          ) : items.length ? (
            <ul className="space-y-1" aria-label={`${category?.categoryName ?? '분류'} 거래 내역`}>
              {items.map((item) => {
                const amount = `${item.statisticsContributionWon > 0 ? '+' : item.statisticsContributionWon < 0 ? '-' : ''}${formatWon(Math.abs(item.statisticsContributionWon))}`
                const label = item.description || item.categoryName
                return (
                  <li key={item.transactionId}>
                    <Link
                      to={`/transactions/${item.transactionId}`}
                      state={{ returnTo }}
                      aria-label={`${label} 거래 상세, ${amount}`}
                      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)]"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold">{label}</p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-[var(--muted)]">
                          <time dateTime={item.occurredOn}>{formatDate(item.occurredOn)}</time>
                          <span aria-hidden="true">·</span><span className="break-words">{item.assetName}</span>
                          {item.performedByMemberId && item.performedByName ? <><span aria-hidden="true">·</span><span className="inline-flex min-w-0 items-center gap-1"><MemberAvatar displayName={item.performedByName} memberId={item.performedByMemberId} size="xs" /><span className="break-words">{item.performedByName}</span></span></> : null}
                        </div>
                      </div>
                      <strong className="shrink-0 text-sm font-semibold tabular-nums">{amount}</strong>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : <p className="py-12 text-center text-sm text-[var(--muted)]">현재 조건에 포함된 거래가 없습니다.</p>}
          {transactions.hasNextPage ? <div className=" py-4 text-center"><Button type="button" variant="secondary" disabled={transactions.isFetchingNextPage} onClick={() => transactions.fetchNextPage()}>{transactions.isFetchingNextPage ? <><LoaderCircle className="animate-spin" size={17} />불러오는 중…</> : '거래 더 보기'}</Button></div> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
