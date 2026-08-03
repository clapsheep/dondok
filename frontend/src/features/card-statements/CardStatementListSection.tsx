import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRight, LoaderCircle, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import type { Asset } from '../assets/api'
import { formatDate, formatWon } from '../assets/format'
import { cardStatementApi, cardStatementKeys } from './api'
import { cardPaymentScheduleStatusLabel, cardStatementStatusLabel, sortCardStatementsForDisplay } from './presentation'

export function CardStatementListSection({ cardAsset, assets }: { cardAsset: Asset; assets: Asset[] }) {
  const [includePaid, setIncludePaid] = useState(false)
  const statements = useInfiniteQuery({
    queryKey: cardStatementKeys.list(cardAsset.assetId, includePaid),
    queryFn: ({ pageParam }) => cardStatementApi.list({ cardAssetId: cardAsset.assetId, cursor: pageParam, includePaid }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: 1,
  })
  const items = useMemo(() => sortCardStatementsForDisplay(statements.data?.pages.flatMap((page) => page.items) ?? []), [statements.data])
  const settlementAsset = assets.find((asset) => asset.assetId === cardAsset.cardSettings?.settlementAssetId)

  return (
    <section className="mt-8 border-t border-[var(--line)] pt-5 @container" aria-labelledby="card-statements-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="card-statements-title" className="text-lg font-semibold">카드 결제 내역</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">명세별 결제 예정 금액과 선결제·정기 결제 기록을 확인해요.</p>
        </div>
        <Button type="button" variant="secondary" aria-pressed={includePaid} onClick={() => setIncludePaid((current) => !current)}>
          {includePaid ? '미결제만 보기' : '완료 내역도 보기'}
        </Button>
      </div>

      <dl className="mt-4 grid gap-x-5 gap-y-2 border-y border-[var(--line)] py-3 text-sm @min-[34rem]:grid-cols-2">
        <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">결제 계좌</dt><dd className="font-semibold">{settlementAsset?.name ?? '설정되지 않음'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">자동 정산</dt><dd className="font-semibold">{cardAsset.cardSettings?.autoSettlementEnabled ? '사용' : '사용 안 함'}</dd></div>
      </dl>

      {statements.isPending ? (
        <p className="mt-5 inline-flex items-center gap-2 text-sm text-[var(--muted)]" role="status"><LoaderCircle className="animate-spin" size={17} />카드 명세를 불러오는 중…</p>
      ) : statements.isError && !statements.data ? (
        <div className="mt-5 border-l-4 border-red-600 px-4 py-2" role="alert">
          <p className="text-sm">카드 결제 내역을 불러오지 못했어요.</p>
          <Button className="mt-3" type="button" variant="secondary" onClick={() => statements.refetch()}><RotateCcw size={17} />다시 불러오기</Button>
        </div>
      ) : items.length ? (
        <ul className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {items.map((statement) => (
            <li key={statement.statementId}>
              <Link
                to={`/assets/${cardAsset.assetId}/card-statements/${statement.statementId}`}
                className="group grid min-h-20 gap-2 py-4 text-sm outline-none transition-colors hover:text-forest-800 focus-visible:ring-3 focus-visible:ring-[var(--ring)] dark:hover:text-forest-100 @min-[34rem]:grid-cols-[minmax(8rem,1fr)_auto] @min-[34rem]:items-center @min-[44rem]:grid-cols-[minmax(8rem,1fr)_minmax(17rem,1.5fr)_auto]"
                aria-label={`${formatDate(statement.dueOn)} ${cardStatementStatusLabel(statement.status)} 카드 명세 보기`}
              >
                <span>
                  <span className="block font-semibold">{formatDate(statement.dueOn)} 결제</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{cardStatementStatusLabel(statement.status)}</span>
                </span>
                <span className="grid grid-cols-3 gap-x-3 gap-y-1 tabular-nums @min-[34rem]:col-span-2 @min-[34rem]:row-start-2 @min-[44rem]:col-span-1 @min-[44rem]:col-start-2 @min-[44rem]:row-start-1">
                  <span><span className="block text-xs text-[var(--muted)]">청구 원금</span><strong className="mt-0.5 block">{formatWon(statement.grossAmountWon)}</strong></span>
                  <span className="text-center"><span className="block text-xs text-[var(--muted)]">결제 완료</span><strong className="mt-0.5 block">{formatWon(statement.paidAmountWon)}</strong></span>
                  <span className="text-right"><span className="block text-xs text-[var(--muted)]">남은 결제</span><strong className="mt-0.5 block">{formatWon(statement.remainingAmountWon)}</strong></span>
                  {statement.automaticSettlement ? <span className="col-span-3 text-xs text-[var(--muted)]">{cardPaymentScheduleStatusLabel(statement.automaticSettlement.status)} · {formatDate(statement.automaticSettlement.scheduledOn)}</span> : null}
                </span>
                <span className="flex items-center justify-end gap-1 font-semibold text-forest-700 dark:text-forest-100 @min-[34rem]:col-start-2 @min-[34rem]:row-start-1 @min-[44rem]:col-start-3">명세 보기<ChevronRight className="transition-transform group-hover:translate-x-0.5" size={17} /></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 border-y border-[var(--line)] py-6 text-center text-sm text-[var(--muted)]">{includePaid ? '아직 카드 명세가 없어요.' : '현재 미결제 카드 명세가 없어요.'}</p>
      )}

      {statements.hasNextPage ? <Button className="mt-4 w-full" type="button" variant="secondary" onClick={() => statements.fetchNextPage()} disabled={statements.isFetchingNextPage}>{statements.isFetchingNextPage ? <LoaderCircle className="animate-spin" size={17} /> : null}결제 내역 더 보기</Button> : null}
      {statements.isError && statements.data ? <p className="mt-3 text-sm text-red-700 dark:text-[#ff9d93]" role="status">최신 결제 내역을 확인하지 못했어요. 지금 보이는 내역은 유지했어요.</p> : null}
    </section>
  )
}
