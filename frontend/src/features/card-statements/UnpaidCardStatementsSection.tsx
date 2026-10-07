import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import type { Asset } from '../assets/api'
import { formatPaymentDueDate, formatWon } from '../assets/format'
import { cardStatementApi, cardStatementKeys } from './api'
import { CardStatementPayButton } from './CardStatementPayButton'
import { sortCardStatementsForDisplay } from './presentation'

export function UnpaidCardStatementsSection({ asset }: { asset: Asset }) {
  const [paidAmount, setPaidAmount] = useState<number | null>(null)
  const statements = useInfiniteQuery({
    queryKey: cardStatementKeys.list(asset.assetId, false),
    queryFn: ({ pageParam }) => cardStatementApi.list({ cardAssetId: asset.assetId, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const items = useMemo(() => sortCardStatementsForDisplay(statements.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => item.remainingAmountWon > 0), [statements.data])
  return <section className="mt-6 border-b border-[var(--line)] pb-4 @container" aria-labelledby="unpaid-card-title">
    <h2 id="unpaid-card-title" className="text-lg font-semibold">미결제 내역</h2>
    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">결제 예정·미결제 대금을 명세별로 모았어요. 결제일이 지난 대금도 직접 결제 기록할 수 있어요.</p>
    {paidAmount !== null ? <p className="mt-3 text-sm text-forest-800 dark:text-forest-100" role="status">{formatWon(paidAmount)} 결제를 기록하고 잔액과 거래 내역에 반영했어요.</p> : null}
    {asset.status !== 'ACTIVE' ? <p className="mt-3 text-sm text-[var(--muted)]">사용 종료한 카드예요. 다시 사용한 뒤 결제 기록할 수 있어요.</p> : null}
    {statements.isPending ? <p className="py-5 text-sm" role="status">미결제 내역을 불러오는 중…</p> : statements.isError && !statements.data ? <div className="py-4" role="alert"><p>미결제 내역을 불러오지 못했어요.</p><Button className="mt-3" variant="secondary" onClick={() => statements.refetch()}>다시 불러오기</Button></div> : items.length ? <ul className="mt-3 divide-y divide-[var(--line-subtle)]">
      {items.map((statement) => <li key={statement.statementId} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0"><h3 className="text-sm font-semibold">{formatPaymentDueDate(statement.dueOn)} 결제</h3><p className="mt-1 text-base font-semibold tabular-nums text-[var(--expense)]">{formatWon(statement.remainingAmountWon)}</p><p className="mt-1 text-xs text-[var(--muted)]">청구 {formatWon(statement.grossAmountWon)} · 결제 완료 {formatWon(statement.paidAmountWon)}</p>{statement.additionalUsageAfterPayment ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">결제 후 사용 내역이 추가됐어요. 추가분은 자동 정산하지 않으니 직접 결제 기록해 주세요.</p> : null}</div>
        <div className="ml-auto flex shrink-0 items-center gap-2"><Button asChild variant="ghost"><Link to={`/assets/${asset.assetId}/card-statements/${statement.statementId}`}>명세 보기</Link></Button><CardStatementPayButton statementId={statement.statementId} disabled={asset.status !== 'ACTIVE'} onPaid={setPaidAmount} /></div>
      </li>)}
    </ul> : <p className="py-5 text-sm text-[var(--muted)]">미결제 카드 대금이 없어요.</p>}
    {statements.hasNextPage ? <Button className="mt-3 w-full" variant="secondary" disabled={statements.isFetchingNextPage} onClick={() => statements.fetchNextPage()}>미결제 내역 더 보기</Button> : null}
    {statements.isError && statements.data ? <p className="mt-3 text-sm" role="alert">최신 내역을 확인하지 못했어요.<Button variant="ghost" onClick={() => statements.refetch()}>다시 불러오기</Button></p> : null}
  </section>
}
