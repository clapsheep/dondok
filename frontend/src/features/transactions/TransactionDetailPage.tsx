import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetKeys } from '../assets/api'
import { formatDate, formatWon } from '../assets/format'
import { cardStatementKeys } from '../card-statements/api'
import { performerPersonLabel } from './performerLabels'
import { transactionApi, transactionKeys, type Transaction } from './api'
import { transactionTypeLabel } from './transactionRow'

type NavigationState = { returnTo?: string }

export function TransactionDetailPage() {
  const { transactionId = '' } = useParams()
  const location = useLocation()
  const transaction = useQuery({
    queryKey: transactionKeys.detail(transactionId),
    queryFn: () => transactionApi.detail(transactionId),
    enabled: Boolean(transactionId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const returnTo = safeReturnTo(location.state, transaction.data?.occurredOn)

  if (transaction.isPending) return <AppShell ledgerNavigation><LoadingState /></AppShell>
  if (transaction.isError && !transaction.data) {
    const missing = transaction.error instanceof ApiError && transaction.error.status === 404
    return <AppShell ledgerNavigation><section className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">{missing ? '거래를 찾을 수 없어요' : '거래를 불러오지 못했어요'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{missing ? '다른 구성원이 이미 삭제했거나 주소가 올바르지 않을 수 있어요.' : '연결을 확인한 뒤 다시 시도해 주세요.'}</p>{missing ? <Button asChild className="mt-5"><Link to={returnTo}>목록으로 돌아가기</Link></Button> : <Button className="mt-5" variant="secondary" onClick={() => transaction.refetch()}>다시 불러오기</Button>}</section></AppShell>
  }
  if (!transaction.data) return null
  if (transaction.data.managementType === 'CARD_PURCHASE') return <Navigate to={`/transactions/${transactionId}/card-purchase`} replace state={location.state} />

  return <TransactionDetail transaction={transaction.data} returnTo={returnTo} />
}

function TransactionDetail({ transaction, returnTo }: { transaction: Transaction; returnTo: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [remoteDeleted, setRemoteDeleted] = useState(false)
  const remove = useMutation({
    mutationFn: (expectedVersion: number) => transactionApi.remove(transaction.transactionId, expectedVersion),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: transactionKeys.detail(transaction.transactionId) })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all, refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: assetKeys.all, refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: cardStatementKeys.all, refetchType: 'none' })
      navigate(returnTo, { replace: true, state: { transactionDeleted: true } })
    },
    onError: (error) => void handleRemoveError(error),
  })

  async function handleRemoveError(error: unknown) {
    if (!(error instanceof ApiError)) return
    setConfirmDelete(false)
    if (error.status === 404) {
      setRemoteDeleted(true)
      return
    }
    if (error.status !== 412) return
    try {
      await queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transaction.transactionId),
        queryFn: () => transactionApi.detail(transaction.transactionId),
        staleTime: 0,
      })
      setConflict(true)
    } catch (latestError) {
      if (latestError instanceof ApiError && latestError.status === 404) setRemoteDeleted(true)
    }
  }
  const editable = transaction.managementType === 'GENERAL'
  const type = transactionTypeLabel(transaction)
  const amountTone = transaction.managementType === 'CARD_REFUND' || transaction.type === 'INCOME'
    ? 'text-[var(--income)]'
    : transaction.type === 'EXPENSE'
      ? 'text-[var(--expense)]'
      : 'text-[var(--transfer)]'
  const updated = Boolean((useLocation().state as { transactionUpdated?: boolean } | null)?.transactionUpdated)

  return (
    <AppShell ledgerNavigation mobileHeader={{ title: '거래 상세', backTo: returnTo, backLabel: '거래 목록으로' }}>
      <section className="mx-auto max-w-[46rem] py-4 md:py-8">
        <Button asChild className="hidden md:inline-flex" variant="ghost"><Link to={returnTo}><ArrowLeft size={17} />목록으로 돌아가기</Link></Button>
        <header className="border-b border-[var(--line)] pb-5 md:mt-3">
          <h1 className="hidden text-2xl font-semibold tracking-[-.025em] md:block">거래 상세</h1>
          <p className="text-sm font-semibold text-[var(--muted)]">{type}</p>
          <p className={`mt-2 text-3xl font-semibold tracking-[-.04em] tabular-nums md:text-4xl ${amountTone}`}>{amountPrefix(transaction)}{formatWon(transaction.amountWon)}</p>
          <p className="mt-3 break-words text-base font-semibold">{transaction.description || transaction.category?.name || type}</p>
        </header>

        {updated ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">거래를 수정했어요.</p> : null}
        {conflict ? <div className="mt-4 border-l-4 border-amber-500 px-4 py-2" role="alert"><p className="font-semibold">다른 구성원이 이 거래를 먼저 변경했어요</p><p className="mt-1 text-sm text-[var(--muted)]">최신 내용을 불러왔어요. 내용을 확인한 뒤 삭제가 필요하면 다시 눌러 주세요.</p></div> : null}
        {remoteDeleted ? <div className="mt-4 border-l-4 border-amber-500 px-4 py-2" role="alert"><p className="font-semibold">다른 구성원이 이 거래를 먼저 삭제했어요</p><Button asChild className="mt-3" variant="secondary"><Link to={returnTo}>목록으로 돌아가기</Link></Button></div> : null}

        <dl className="divide-y divide-[var(--line-subtle)] border-b border-[var(--line)] text-sm">
          <DetailRow label="날짜" value={formatDate(transaction.occurredOn)} />
          {transaction.category ? <DetailRow label="분류" value={transaction.category.name} /> : null}
          <DetailRow label="자산 흐름" value={postingFlow(transaction)} />
          <DetailRow label={performerPersonLabel(transaction.type)} value={<MemberValue transaction={transaction} />} />
          {transaction.createdBy && transaction.createdBy.memberId !== transaction.performedBy?.memberId ? <DetailRow label="기록한 사람" value={<span className="inline-flex items-center gap-1.5"><MemberAvatar displayName={transaction.createdBy.displayName} memberId={transaction.createdBy.memberId} size="xs" />{transaction.createdBy.displayName}</span>} /> : null}
          {transaction.installmentCount && transaction.installmentCount > 1 ? <DetailRow label="할부" value={`${transaction.installmentCount}개월`} /> : null}
          {transaction.type !== 'TRANSFER' ? <DetailRow label="달력·통계" value={transaction.excludedFromStatistics ? '집계 제외' : '집계 포함'} /> : null}
          {transaction.description ? <DetailRow label="내용" value={transaction.description} /> : null}
        </dl>

        {transaction.managementType === 'CARD_REFUND' && transaction.relatedPurchaseTransactionId ? <section className="border-b border-[var(--line)] py-5"><p className="text-sm leading-6 text-[var(--muted)]">카드 환불은 원 구매와 결제 계좌 반환 내역을 함께 관리해요.</p><Button asChild className="mt-3" variant="secondary"><Link to={`/transactions/${transaction.relatedPurchaseTransactionId}/card-purchase`} state={{ returnTo }}>원 카드 구매 보기</Link></Button></section> : null}
        {transaction.managementType === 'SYSTEM' ? <p className="border-b border-[var(--line)] py-5 text-sm leading-6 text-[var(--muted)]">카드 정산처럼 자동으로 생성된 기록은 연결된 흐름에서 관리하므로 직접 편집하거나 삭제할 수 없어요.</p> : null}

        {editable && !remoteDeleted ? (
          <section className="pt-6" aria-label="거래 관리">
            <div className="grid gap-3 xs:grid-cols-2">
              <Button asChild size="large"><Link to={`/transactions/${transaction.transactionId}/edit`} state={{ returnTo }}><Pencil size={18} />기록 편집</Link></Button>
              <Button type="button" size="large" variant="secondary" disabled={!online} onClick={() => { setConfirmDelete(true); setConflict(false); remove.reset() }}><Trash2 size={18} />기록 삭제</Button>
            </div>
            {confirmDelete ? <div className="mt-4 border-y border-[var(--line)] py-4"><h2 className="font-semibold">이 거래를 삭제할까요?</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{transaction.type === 'TRANSFER' ? '보내는 자산과 받는 자산의 잔액을 함께 되돌립니다.' : '자산 잔액을 되돌리고 달력과 통계에서도 제거합니다.'}</p>{remove.error && !(remove.error instanceof ApiError && [404, 412].includes(remove.error.status)) ? <p className="mt-3 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{remove.error.message}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={remove.isPending || !online} onClick={() => remove.mutate(transaction.version)}>{remove.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}삭제하기</Button><Button type="button" variant="secondary" onClick={() => { setConfirmDelete(false); remove.reset() }}>취소</Button></div></div> : null}
          </section>
        ) : null}
      </section>
    </AppShell>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 py-3.5"><dt className="text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words font-semibold">{value}</dd></div>
}

function MemberValue({ transaction }: { transaction: Transaction }) {
  if (!transaction.performedBy) return <>자동 기록</>
  return <span className="inline-flex items-center gap-1.5"><MemberAvatar displayName={transaction.performedBy.displayName} memberId={transaction.performedBy.memberId} size="xs" />{transaction.performedBy.displayName}</span>
}

function postingFlow(transaction: Transaction) {
  if (transaction.type === 'TRANSFER') {
    const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetName
    const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetName
    return source && destination ? `${source} → ${destination}` : '자산 이체'
  }
  const posting = transaction.postings[0]
  if (transaction.asset && posting && transaction.asset.assetId !== posting.assetId) return `${transaction.asset.name} · ${posting.assetName}에서 반영`
  return transaction.asset?.name ?? posting?.assetName ?? '자산 정보 없음'
}

function amountPrefix(transaction: Transaction) {
  if (transaction.managementType === 'CARD_REFUND' || transaction.type === 'INCOME') return '+'
  if (transaction.type === 'EXPENSE') return '-'
  return ''
}

function safeReturnTo(state: unknown, occurredOn?: string) {
  const value = (state as NavigationState | null)?.returnTo
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : `/?view=daily&month=${(occurredOn ?? todayInSeoul()).slice(0, 7)}`
}

function todayInSeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) }
function LoadingState() { return <div className="grid min-h-[70dvh] place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />거래를 불러오는 중…</span></div> }
