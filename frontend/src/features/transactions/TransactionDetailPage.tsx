import { transferPurposeLabels } from './transferPurpose'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetKeys } from '../assets/api'
import { formatDate, formatWon } from '../assets/format'
import { cardStatementApi, cardStatementKeys } from '../card-statements/api'
import { performerPersonLabel } from './performerLabels'
import { transactionApi, transactionKeys, type Transaction } from './api'
import { TransactionActionLink, TransactionDetailLayout, TransactionHero, TransactionReflection, TransactionAudit, TransactionDetailRow as DetailRow } from './TransactionDetailLayout'

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

export function TransactionDetail({ transaction, returnTo, editing = false }: { transaction: Transaction; returnTo: string; editing?: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const [confirmCancelPayment, setConfirmCancelPayment] = useState(false)
  const [paymentConflict, setPaymentConflict] = useState(false)
  const [remoteDeleted, setRemoteDeleted] = useState(false)
  const cancelPayment = useMutation({
    mutationFn: () => {
      const payment = transaction.cardPayment
      if (!payment) throw new Error('카드 결제 연결 정보를 찾을 수 없습니다.')
      return cardStatementApi.cancelPayment(
        payment.statementId,
        payment.paymentId,
        payment.statementVersion,
      )
    },
    onSuccess: (result) => {
      queryClient.setQueryData(cardStatementKeys.detail(result.statement.statementId), result.statement)
      queryClient.removeQueries({ queryKey: transactionKeys.detail(result.cancelledTransactionId) })
      void queryClient.invalidateQueries({ queryKey: cardStatementKeys.all, refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all, refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: assetKeys.all, refetchType: 'none' })
      navigate(returnTo, { replace: true, state: transaction.cardPayment?.paymentType === 'REGULAR' ? { automaticSettlementCancelled: true } : transaction.cardPayment?.paymentType === 'MANUAL' ? { manualPaymentCancelled: true } : { prepaymentCancelled: true } })
    },
    onError: async (error) => {
      if (!(error instanceof ApiError)) return
      if (error.status === 404) {
        setConfirmCancelPayment(false)
        setRemoteDeleted(true)
        return
      }
      if (error.status !== 412) return
      setPaymentConflict(true)
      await queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transaction.transactionId),
        queryFn: () => transactionApi.detail(transaction.transactionId),
        staleTime: 0,
      }).catch((latestError) => {
        if (latestError instanceof ApiError && latestError.status === 404) {
          setConfirmCancelPayment(false)
          setRemoteDeleted(true)
        }
      })
    },
  })

  const editable = transaction.managementType === 'GENERAL'
  const cancellableCardPayment = transaction.managementType === 'SYSTEM'
    && transaction.cardPayment
    && ['PREPAYMENT', 'REGULAR', 'MANUAL'].includes(transaction.cardPayment.paymentType)
  const paymentCardId = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetId
  const manualPayment = transaction.cardPayment?.paymentType === 'MANUAL'
  const automaticSettlement = cancellableCardPayment && transaction.cardPayment?.paymentType === 'REGULAR'
  const updated = Boolean((useLocation().state as { transactionUpdated?: boolean } | null)?.transactionUpdated)

  return (
    <TransactionDetailLayout title={editing ? '결제 기록 편집' : '거래 상세'} returnTo={returnTo} actions={!editing && !remoteDeleted ? <div className="flex items-center" aria-label="기록 관리">
      {editable || cancellableCardPayment ? <TransactionActionLink to={`/transactions/${transaction.transactionId}/edit`} returnTo={returnTo} label="기록 편집" icon={Pencil} /> : null}
      {transaction.managementType === 'CARD_REFUND' && transaction.relatedPurchaseTransactionId ? <TransactionActionLink to={`/transactions/${transaction.relatedPurchaseTransactionId}/card-purchase`} returnTo={returnTo} label="원 카드 구매 보기" icon={ReceiptText} /> : null}
    </div> : undefined}>
        <TransactionHero transaction={transaction} />

        {updated ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">거래를 수정했어요.</p> : null}
        {remoteDeleted ? <div className="mt-4 border-l-4 border-amber-500 px-4 py-2" role="alert"><p className="font-semibold">다른 구성원이 이 거래를 먼저 삭제했어요</p><Button asChild className="mt-3" variant="secondary"><Link to={returnTo}>목록으로 돌아가기</Link></Button></div> : null}

        <div className="td-columns"><section className="td-information" aria-label="거래 정보"><h2>거래 정보</h2><dl>
          {transaction.category ? <DetailRow label="분류" value={transaction.category.name} /> : null}
          {transaction.type === 'TRANSFER' ? transaction.postings.map(posting => <DetailRow key={posting.assetId} label={posting.deltaWon < 0 ? '출금 자산' : '입금 자산'} value={<Link to={`/assets/${posting.assetId}`}>{posting.assetName}</Link>}/>) : <DetailRow label={transaction.type === 'INCOME' || transaction.managementType === 'CARD_REFUND' ? '입금 자산' : '결제 자산'} value={transaction.asset ? <Link to={`/assets/${transaction.asset.assetId}`}>{postingFlow(transaction)}</Link> : postingFlow(transaction)} /> }
          <DetailRow label={transaction.transferSubtype === 'CARD_SETTLEMENT' || transaction.transferSubtype === 'CARD_PREPAYMENT' ? '카드 명의자' : performerPersonLabel(transaction.type)} value={<MemberValue transaction={transaction} />} />
          {transaction.installmentCount && transaction.installmentCount > 1 ? <DetailRow label="할부" value={`${transaction.installmentCount}개월`} /> : null}
          {transaction.transferPurpose ? <DetailRow label="이체 목적" value={transferPurposeLabels[transaction.transferPurpose]} /> : null}
        </dl></section><TransactionReflection transaction={transaction}/></div>
        <TransactionAudit transaction={transaction}/>


        {cancellableCardPayment && editing && paymentCardId ? <Button asChild className="mt-5" variant="secondary"><Link to={`/assets/${paymentCardId}/card-statements/${transaction.cardPayment!.statementId}`}>결제 내역에서 출금 계좌 변경</Link></Button> : null}
        {cancellableCardPayment && editing ? (
          <section className="mt-10 border-t border-[var(--line-subtle)] pt-6" aria-label="카드 결제 관리">
            <h2 className="mb-3 text-lg font-semibold">결제 기록 취소</h2>
            <p className="text-sm leading-6 text-[var(--muted)]">{automaticSettlement ? '자동 정산 기록이에요. 삭제하면 해당 결제일 대금은 자동으로 다시 정산되지 않아요.' : manualPayment ? '직접 기록한 카드 전액 결제예요. 취소하면 자동 정산도 중단돼요.' : '직접 기록한 카드 선결제예요.'} 취소하면 결제 계좌 잔액이 복원되고 카드 미결제 금액이 다시 늘어납니다.</p>
            {transaction.cardPayment!.returnedAmountWon > 0 ? <p className="mt-3 text-sm text-amber-900 dark:text-[#ffe3a3]">이 결제로 반환된 환불 금액이 있어 바로 취소할 수 없어요.</p> : <Button className="mt-4" type="button" variant="destructive" disabled={!online} onClick={() => { setConfirmCancelPayment(true); setPaymentConflict(false); cancelPayment.reset() }}><Trash2 size={17} />{automaticSettlement ? '자동 정산 삭제' : manualPayment ? '수동 결제 취소' : '선결제 취소'}</Button>}
          </section>
        ) : transaction.managementType === 'SYSTEM' && !cancellableCardPayment ? <p className="border-b border-[var(--line)] py-5 text-sm leading-6 text-[var(--muted)]">카드 자동 정산처럼 시스템이 생성한 기록은 연결된 카드 결제 내역에서 관리하므로 직접 편집하거나 삭제할 수 없어요.</p> : null}

      <Dialog open={confirmCancelPayment} onOpenChange={(open) => { if (!open && !cancelPayment.isPending) setConfirmCancelPayment(false) }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{automaticSettlement ? '자동 정산을 삭제할까요?' : manualPayment ? '수동 결제를 취소할까요?' : '선결제를 취소할까요?'}</DialogTitle>
          <DialogDescription className="mt-2">{formatDate(transaction.occurredOn)}에 기록한 {formatWon(transaction.amountWon)} {automaticSettlement ? '자동 정산을 삭제' : manualPayment ? '수동 결제를 취소' : '선결제를 취소'}합니다. 결제 계좌 잔액은 복원되고 카드 미결제 금액은 다시 늘어납니다.{automaticSettlement || manualPayment ? ' 해당 결제일 대금은 자동으로 다시 정산되지 않습니다.' : ''}</DialogDescription>
          {paymentConflict ? <p className="mt-4 border-l-4 border-amber-500 px-3 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="alert">다른 변경이 먼저 저장되어 최신 결제 상태를 불러왔어요. 내용을 확인하고 다시 취소해 주세요.</p> : cancelPayment.error ? <p className="mt-4 border-l-4 border-red-600 px-3 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{cancelPayment.error.message}</p> : null}
          <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={cancelPayment.isPending} onClick={() => setConfirmCancelPayment(false)}>유지</Button><Button type="button" variant="destructive" disabled={!online || cancelPayment.isPending || !transaction.cardPayment} onClick={() => { setPaymentConflict(false); cancelPayment.mutate() }}>{cancelPayment.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}{automaticSettlement ? '자동 정산 삭제' : manualPayment ? '수동 결제 취소' : '선결제 취소'}</Button></div>
        </DialogContent>
      </Dialog>
    </TransactionDetailLayout>
  )
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

function safeReturnTo(state: unknown, occurredOn?: string) {
  const value = (state as NavigationState | null)?.returnTo
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : `/?view=daily&month=${(occurredOn ?? todayInSeoul()).slice(0, 7)}`
}

function todayInSeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) }
function LoadingState() { return <div className="grid min-h-[70dvh] place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />거래를 불러오는 중…</span></div> }
