import { CardStatementPayButton } from './CardStatementPayButton'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Landmark, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { AssetPicker } from '../assets/AssetPicker'
import { assetApi, assetKeys, type Asset } from '../assets/api'
import { formatDate, formatWon } from '../assets/format'
import type { LedgerBook } from '../membership/api'
import { transactionKeys } from '../transactions/api'
import { StatementPrepaymentPanel } from './StatementPrepaymentPanel'
import {
  cardStatementApi,
  cardStatementKeys,
  type CardStatementDetail,
  type CardStatementPayment,
  type CardStatementPrepaymentPreview,
  type CreateCardStatementPrepaymentInput,
} from './api'
import {
  acceptStatementPrepaymentPreview,
  changeStatementPrepaymentAmount,
  createStatementPrepaymentWorkflow,
  markStatementPrepaymentConflict,
  markStatementPrepaymentMissing,
  rebaseStatementPrepaymentWorkflow,
  validateStatementPrepaymentDraft,
  type StatementSnapshot,
} from './prepaymentState'
import {  cardStatementPaymentTypeLabel, cardStatementStatusLabel } from './presentation'

export function CardStatementPage({ ledger }: { ledger: LedgerBook }) {
  const { statementId = '' } = useParams()
  const statement = useQuery({
    queryKey: cardStatementKeys.detail(statementId),
    queryFn: () => cardStatementApi.detail(statementId),
    enabled: Boolean(statementId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })

  if (statement.isPending) return <AppShell ledgerNavigation><PageLoading /></AppShell>
  if (!statement.data) {
    const missing = statement.error instanceof ApiError && statement.error.status === 404
    return <AppShell ledgerNavigation><PageUnavailable missing={missing} onRetry={() => statement.refetch()} /></AppShell>
  }

  return <CardStatementContent key={statementId} statement={statement.data} ledger={ledger} />
}

function CardStatementContent({ statement, ledger }: { statement: CardStatementDetail; ledger: LedgerBook }) {
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const [workflow, setWorkflow] = useState(() => createStatementPrepaymentWorkflow<CardStatementPrepaymentPreview>(snapshot(statement)))
  const [amountError, setAmountError] = useState<string>()
  const [success, setSuccess] = useState<string>()
  const [requestInProgress, setRequestInProgress] = useState(false)
  const [editingPayment, setEditingPayment] = useState<{ paymentId: string; settlementAssetId: string }>()
  const [accountCorrectionConflict, setAccountCorrectionConflict] = useState(false)
  const [cancellingPayment, setCancellingPayment] = useState<CardStatementPayment>()
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const idempotency = useRef<{ previewToken: string; key: string } | undefined>(undefined)
  const assets = useQuery({
    queryKey: assetKeys.list,
    queryFn: assetApi.list,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const cardAsset = useQuery({
    queryKey: assetKeys.detail(statement.cardAsset.assetId),
    queryFn: () => assetApi.detail(statement.cardAsset.assetId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })

  useEffect(() => {
    if (!workflow.preview) return
    const frame = requestAnimationFrame(() => previewHeading.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [workflow.preview])

  async function loadLatestConflict() {
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: cardStatementKeys.detail(statement.statementId),
        queryFn: () => cardStatementApi.detail(statement.statementId),
        staleTime: 0,
      })
      setWorkflow((current) => markStatementPrepaymentConflict(current, snapshot(latest)))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setWorkflow((current) => markStatementPrepaymentMissing(current))
    }
  }

  async function reconcileRequestInProgress() {
    setRequestInProgress(true)
    void queryClient.invalidateQueries({ queryKey: cardStatementKeys.lists() })
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
    void queryClient.invalidateQueries({ queryKey: assetKeys.all })
    await loadLatestConflict()
  }

  const previewMutation = useMutation({
    mutationFn: (input: CreateCardStatementPrepaymentInput) => cardStatementApi.previewPrepayment(statement.statementId, input),
    onSuccess: (preview) => {
      setWorkflow((current) => acceptStatementPrepaymentPreview(current, preview, preview.statementVersion))
      idempotency.current = undefined
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 412) void loadLatestConflict()
      if (error instanceof ApiError && error.status === 404) setWorkflow((current) => markStatementPrepaymentMissing(current))
    },
  })

  const applyMutation = useMutation({
    mutationFn: ({ input, key }: { input: CreateCardStatementPrepaymentInput & { previewToken: string }; key: string }) => cardStatementApi.applyPrepayment(statement.statementId, input, key),
    onSuccess: (result) => {
      queryClient.setQueryData(cardStatementKeys.detail(statement.statementId), result.statement)
      queryClient.setQueryData(transactionKeys.detail(result.settlementTransaction.transactionId), result.settlementTransaction)
      void queryClient.invalidateQueries({ queryKey: cardStatementKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      void queryClient.invalidateQueries({ queryKey: assetKeys.all })
      setWorkflow(createStatementPrepaymentWorkflow<CardStatementPrepaymentPreview>(snapshot(result.statement)))
      setAmountError(undefined)
      setSuccess(`${formatWon(result.payment.amountWon)}을 ${formatDate(result.payment.paidOn)} 선결제로 기록했어요.`)
      setRequestInProgress(false)
      idempotency.current = undefined
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 412) void loadLatestConflict()
      if (error instanceof ApiError && error.status === 404) setWorkflow((current) => markStatementPrepaymentMissing(current))
      if (error instanceof ApiError && error.errorCode === 'IDEMPOTENCY_REQUEST_IN_PROGRESS') void reconcileRequestInProgress()
    },
  })

  const correctPaymentAccountMutation = useMutation({
    mutationFn: ({ paymentId, settlementAssetId, expectedVersion }: { paymentId: string; settlementAssetId: string; expectedVersion: number }) => cardStatementApi.correctPaymentAccount(
      statement.statementId,
      paymentId,
      { settlementAssetId, expectedVersion },
    ),
    onSuccess: (result) => {
      queryClient.setQueryData(cardStatementKeys.detail(statement.statementId), result.statement)
      queryClient.setQueryData(transactionKeys.detail(result.settlementTransaction.transactionId), result.settlementTransaction)
      void queryClient.invalidateQueries({ queryKey: cardStatementKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      void queryClient.invalidateQueries({ queryKey: assetKeys.all })
      setWorkflow(createStatementPrepaymentWorkflow<CardStatementPrepaymentPreview>(snapshot(result.statement)))
      setEditingPayment(undefined)
      setAccountCorrectionConflict(false)
      setSuccess(`${formatDate(result.payment.paidOn)} ${cardStatementPaymentTypeLabel(result.payment.paymentType)}의 출금 계좌를 ${result.payment.settlementAssetName}(으)로 변경했어요.`)
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 412) return
      setAccountCorrectionConflict(true)
      await queryClient.fetchQuery({
        queryKey: cardStatementKeys.detail(statement.statementId),
        queryFn: () => cardStatementApi.detail(statement.statementId),
        staleTime: 0,
      }).catch(() => undefined)
    },
  })

  const cancelPaymentMutation = useMutation({
    mutationFn: ({ paymentId, expectedVersion }: { paymentId: string; expectedVersion: number }) => cardStatementApi.cancelPayment(
      statement.statementId,
      paymentId,
      expectedVersion,
    ),
    onSuccess: (result) => {
      queryClient.setQueryData(cardStatementKeys.detail(statement.statementId), result.statement)
      queryClient.removeQueries({ queryKey: transactionKeys.detail(result.cancelledTransactionId) })
      void queryClient.invalidateQueries({ queryKey: cardStatementKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      void queryClient.invalidateQueries({ queryKey: assetKeys.all })
      setWorkflow(createStatementPrepaymentWorkflow<CardStatementPrepaymentPreview>(snapshot(result.statement)))
      setCancellingPayment(undefined)
      setSuccess(`${cancellingPayment?.paymentType === 'REGULAR' ? '자동 정산' : cancellingPayment?.paymentType === 'MANUAL' ? '수동 결제' : '선결제'}을 취소하고 결제 계좌와 카드 잔액을 되돌렸어요.`)
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.status !== 412) return
      await queryClient.fetchQuery({
        queryKey: cardStatementKeys.detail(statement.statementId),
        queryFn: () => cardStatementApi.detail(statement.statementId),
        staleTime: 0,
      }).catch(() => undefined)
    },
  })

  const authoritative = queryClient.getQueryData<CardStatementDetail>(cardStatementKeys.detail(statement.statementId)) ?? statement
  const cardInactive = cardAsset.data?.status === 'ARCHIVED'
  const currentLimit = workflow.conflict?.prepayableAmountWon ?? authoritative.prepayableAmountWon
  const paymentSourceAssets = (assets.data ?? []).filter((asset) => asset.paymentSourceCapable && asset.ownerMemberId === cardAsset.data?.ownerMemberId)

  function updateAmount(value: string) {
    setWorkflow((current) => changeStatementPrepaymentAmount(current, value))
    setAmountError(undefined)
    setSuccess(undefined)
    setRequestInProgress(false)
    previewMutation.reset()
    applyMutation.reset()
  }

  function previewWith(version: number, prepayableAmountWon: number) {
    const parsed = validateStatementPrepaymentDraft(workflow.draft, prepayableAmountWon)
    setAmountError(parsed.errors.amountWon)
    if (!parsed.amountWon) return
    previewMutation.mutate({ amountWon: parsed.amountWon, expectedVersion: version })
  }

  function requestPreview() {
    if (!online || workflow.conflict || workflow.remoteMissing) return
    previewWith(workflow.baseVersion, authoritative.prepayableAmountWon)
  }

  function recalculateLatest() {
    if (!workflow.conflict || !online) return
    const latest = workflow.conflict
    const parsed = validateStatementPrepaymentDraft(workflow.draft, latest.prepayableAmountWon)
    setAmountError(parsed.errors.amountWon)
    if (!parsed.amountWon) return
    setWorkflow((current) => rebaseStatementPrepaymentWorkflow(current))
    previewMutation.mutate({ amountWon: parsed.amountWon, expectedVersion: latest.version })
  }

  function applyPrepayment() {
    const preview = workflow.preview
    if (!preview || !online || workflow.conflict || workflow.remoteMissing) return
    const key = idempotency.current?.previewToken === preview.previewToken
      ? idempotency.current.key
      : crypto.randomUUID()
    idempotency.current = { previewToken: preview.previewToken, key }
    applyMutation.mutate({
      key,
      input: { amountWon: preview.amountWon, expectedVersion: workflow.baseVersion, previewToken: preview.previewToken },
    })
  }

  return (
    <AppShell ledgerNavigation>
      <section className="statement-page">
        <Button asChild variant="ghost"><Link to={`/assets/${authoritative.cardAsset.assetId}/card-payment?history=1`}><ArrowLeft size={17} />카드 대금으로 돌아가기</Link></Button>
        <header className="mt-4 ui-page-section pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-forest-700 dark:text-forest-100">{authoritative.cardAsset.name}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-.025em]">{formatDate(authoritative.dueOn)} 카드 결제 내역</h1>
            </div>
            <span className="rounded-full bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">{cardStatementStatusLabel(authoritative.status)}</span>
          </div>
        </header>

        {success ? <p className="mt-4 ui-notice px-4 py-2 text-sm" role="status">{success}</p> : null}
        {cardInactive ? <p className="mt-4 ui-notice px-4 py-2 text-sm leading-6 text-amber-950 dark:text-[#ffe3a3]" role="status">사용 종료한 카드예요. 과거 결제 내역은 확인할 수 있지만 예약 결제와 새 선결제는 중단됩니다. 다시 사용하면 남은 예약을 이어갈 수 있어요.</p> : null}
        {requestInProgress ? <p className="mt-4 ui-notice px-4 py-2 text-sm leading-6 text-amber-900 dark:text-[#ffe3a3]" role="status">같은 선결제 요청을 서버에서 처리 중이에요. 최신 청구 금액과 결제 기록을 다시 확인했으니 잠시 후 영향을 다시 계산해 주세요.</p> : null}
        <StatementSummary statement={authoritative} />
        <PaymentHistory
          statement={authoritative}
          assets={paymentSourceAssets}
          members={ledger.members}
          editing={editingPayment}
          online={online}
          pending={correctPaymentAccountMutation.isPending}
          error={correctPaymentAccountMutation.error}
          conflict={accountCorrectionConflict}
          onEdit={(payment) => {
            correctPaymentAccountMutation.reset()
            setAccountCorrectionConflict(false)
            setSuccess(undefined)
            setEditingPayment({ paymentId: payment.paymentId, settlementAssetId: '' })
          }}
          onAssetChange={(settlementAssetId) => setEditingPayment((current) => current ? { ...current, settlementAssetId } : current)}
          onCancel={() => { setEditingPayment(undefined); setAccountCorrectionConflict(false); correctPaymentAccountMutation.reset() }}
          onSave={() => {
            if (!editingPayment?.settlementAssetId) return
            setAccountCorrectionConflict(false)
            correctPaymentAccountMutation.mutate({ ...editingPayment, expectedVersion: authoritative.version })
          }}
          onCancelPayment={(payment) => {
            cancelPaymentMutation.reset()
            setSuccess(undefined)
            setCancellingPayment(payment)
          }}
        />

        {!cardInactive && authoritative.remainingAmountWon > 0 && ['OPEN', 'FINALIZED'].includes(authoritative.status) ? <section className="statement-actions" aria-label="미결제 전액 결제"><h2 className="mb-3 text-lg font-semibold">미결제 전액 결제</h2><CardStatementPayButton statementId={authoritative.statementId} onPaid={(amount) => setSuccess(`${formatWon(amount)} 수동 결제를 기록했어요.`)} /></section> : null}
        {cardInactive ? null : authoritative.prepayableAmountWon > 0 && authoritative.settlementAsset ? (
          <StatementPrepaymentPanel
            workflow={workflow}
            currentRemainingAmountWon={authoritative.remainingAmountWon}
            currentPrepayableAmountWon={currentLimit}
            amountError={amountError}
            online={online}
            previewPending={previewMutation.isPending}
            applyPending={applyMutation.isPending}
            previewHeadingRef={previewHeading}
            onAmountChange={updateAmount}
            onPreview={requestPreview}
            onApply={applyPrepayment}
            onRecalculateLatest={recalculateLatest}
          />
        ) : authoritative.remainingAmountWon > 0 && !authoritative.settlementAsset ? (
          <section className="ui-page-section pt-5" aria-labelledby="prepayment-unavailable-title">
            <h2 id="prepayment-unavailable-title" className="text-lg font-semibold">선결제 준비가 필요해요</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">카드 자산에 결제 계좌를 먼저 설정하면 선결제할 수 있어요.</p>
            <Button asChild className="mt-4" variant="secondary"><Link to={`/assets/${authoritative.cardAsset.assetId}/edit`}>결제 계좌 설정</Link></Button>
          </section>
        ) : authoritative.remainingAmountWon > 0 ? (
          <p className="ui-page-section pt-5 text-sm text-[var(--muted)]">부분 선결제는 결제일 전까지만 가능해요. 남은 전액은 위의 결제하기로 기록할 수 있어요.</p>
        ) : (
          <p className="ui-page-section pt-5 text-sm text-[var(--muted)]">해당 결제일의 결제가 모두 완료됐어요.</p>
        )}

        <MutationError error={previewMutation.error} hidden={Boolean(workflow.conflict || workflow.remoteMissing)} fallback="선결제 영향을 계산하지 못했어요." />
        <MutationError error={applyMutation.error} hidden={Boolean(workflow.conflict || workflow.remoteMissing)} fallback="선결제를 기록하지 못했어요." />
      </section>
      <Dialog open={Boolean(cancellingPayment)} onOpenChange={(open) => { if (!open && !cancelPaymentMutation.isPending) setCancellingPayment(undefined) }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{cancellingPayment?.paymentType === 'REGULAR' ? '자동 정산을 삭제할까요?' : cancellingPayment?.paymentType === 'MANUAL' ? '수동 결제를 취소할까요?' : '선결제를 취소할까요?'}</DialogTitle>
          <DialogDescription className="mt-2">{cancellingPayment ? `${formatDate(cancellingPayment.paidOn)}에 기록한 ${formatWon(cancellingPayment.amountWon)} ${cancellingPayment.paymentType === 'REGULAR' ? '자동 정산을 삭제' : cancellingPayment.paymentType === 'MANUAL' ? '수동 결제를 취소' : '선결제를 취소'}합니다. 결제 계좌 잔액은 복원되고 카드 미결제 금액은 다시 늘어납니다.${cancellingPayment.paymentType !== 'PREPAYMENT' ? ' 해당 결제일 대금은 자동으로 다시 정산되지 않습니다.' : ''}` : ''}</DialogDescription>
          {cancelPaymentMutation.error ? <p className="mt-4 ui-notice px-3 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{cancelPaymentMutation.error.message}</p> : null}
          <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={cancelPaymentMutation.isPending} onClick={() => setCancellingPayment(undefined)}>유지</Button><Button type="button" variant="destructive" disabled={!online || cancelPaymentMutation.isPending || !cancellingPayment} onClick={() => cancellingPayment && cancelPaymentMutation.mutate({ paymentId: cancellingPayment.paymentId, expectedVersion: authoritative.version })}>{cancelPaymentMutation.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}{cancellingPayment?.paymentType === 'REGULAR' ? '자동 정산 삭제' : cancellingPayment?.paymentType === 'MANUAL' ? '수동 결제 취소' : '선결제 취소'}</Button></div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function StatementSummary({ statement }: { statement: CardStatementDetail }) {
  return (
    <section className="statement-summary" aria-labelledby="statement-summary-title">
      <h2 id="statement-summary-title" className="sr-only">결제 내역 요약</h2>
      <dl className="grid gap-4 @min-[32rem]:grid-cols-2 @min-[44rem]:grid-cols-4">
        <SummaryValue label="청구 금액" value={formatWon(statement.grossAmountWon)} />
        <SummaryValue label="결제 완료" value={formatWon(statement.paidAmountWon)} />
        <SummaryValue label="남은 결제" value={formatWon(statement.remainingAmountWon)} emphasized />
        <SummaryValue label="결제 계좌" value={statement.settlementAsset?.name ?? '설정되지 않음'} />
      </dl>
      {statement.additionalUsageAfterPayment && statement.remainingAmountWon > 0 ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">결제 후 사용 내역이 추가됐어요. 기존 결제는 유지되며 추가분은 자동 정산하지 않아요. 남은 금액을 직접 결제 기록해 주세요.</p> : null}

    </section>
  )
}

function SummaryValue({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className={`mt-1 font-semibold tabular-nums ${emphasized ? 'text-2xl text-[var(--foreground)]' : ''}`}>{value}</dd></div>
}

function PaymentHistory({ statement, assets, members, editing, online, pending, error, conflict, onEdit, onAssetChange, onCancel, onSave, onCancelPayment }: {
  statement: CardStatementDetail
  assets: Asset[]
  members: LedgerBook['members']
  editing?: { paymentId: string; settlementAssetId: string }
  online: boolean
  pending: boolean
  error: Error | null
  conflict: boolean
  onEdit: (payment: CardStatementPayment) => void
  onAssetChange: (assetId: string) => void
  onCancel: () => void
  onSave: () => void
  onCancelPayment: (payment: CardStatementPayment) => void
}) {
  return (
    <section className="statement-history" aria-labelledby="statement-payment-history-title">
      <h2 id="statement-payment-history-title" className="text-lg font-semibold">결제 기록</h2>
      {statement.payments.length ? (
        <ul className="mt-3 space-y-3 text-sm">
          {statement.payments.map((payment) => (
            <li className="grid gap-2 py-3 @min-[32rem]:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]:items-center" key={payment.paymentId}>
              <span><strong>{cardStatementPaymentTypeLabel(payment.paymentType)}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{formatDate(payment.paidOn)} · {payment.settlementAssetName}</span></span>
              <div className="flex flex-wrap items-center gap-2 @min-[32rem]:justify-end"><span className="font-semibold tabular-nums">{formatWon(payment.effectiveAmountWon)}{payment.returnedAmountWon > 0 ? <span className="mt-1 block text-xs font-normal text-[var(--muted)]">반환 {formatWon(payment.returnedAmountWon)}</span> : null}</span>{payment.returnedAmountWon === 0 ? <Button type="button" variant="ghost" onClick={() => onEdit(payment)} disabled={pending}><Landmark size={16} />출금 계좌 변경</Button> : null}{payment.returnedAmountWon === 0 ? <Button type="button" variant="ghost" onClick={() => onCancelPayment(payment)} disabled={pending}><Trash2 size={16} />{payment.paymentType === 'REGULAR' ? '자동 정산 삭제' : payment.paymentType === 'MANUAL' ? '수동 결제 취소' : '선결제 취소'}</Button> : null}</div>
              {editing?.paymentId === payment.paymentId ? (
                <div className="mt-4 pt-3 @min-[32rem]:col-span-2">
                  <p className="text-sm leading-6 text-[var(--muted)]">금액과 결제일은 그대로 두고 출금 계좌만 변경해요.</p>
                  <div className="mt-3 max-w-[34rem]"><AssetPicker id={`payment-account-${payment.paymentId}`} label="변경할 출금 계좌" assets={assets} members={members} value={editing.settlementAssetId} onChange={onAssetChange} placeholder="계좌를 선택해 주세요" disabled={pending} required /></div>
                  {conflict ? <p className="mt-3 ui-notice px-3 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="alert">다른 변경이 먼저 저장되어 최신 결제 기록을 불러왔어요. 선택한 계좌를 확인한 뒤 다시 변경해 주세요.</p> : error ? <p className="mt-3 ui-notice px-3 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error.message}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={onSave} disabled={!online || pending || !editing.settlementAssetId}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}계좌 변경</Button><Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>닫기</Button></div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 ui-soft-panel py-5 text-sm text-[var(--muted)]">아직 결제 기록이 없어요.</p>}
    </section>
  )
}

function MutationError({ error, hidden, fallback }: { error: Error | null; hidden: boolean; fallback: string }) {
  if (!error || hidden) return null
  const message = error instanceof ApiError && error.errorCode === 'CARD_SETTLEMENT_ASSET_REQUIRED'
    ? '카드 자산에 결제 계좌를 설정한 뒤 다시 시도해 주세요.'
    : error instanceof ApiError && error.errorCode === 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
      ? '같은 선결제 요청을 서버에서 처리 중이에요. 최신 청구 금액과 결제 기록을 다시 확인하고 있으니 잠시 후 다시 시도해 주세요.'
    : error.message || fallback
  return <p className="mt-4 ui-notice px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{message} 입력은 그대로 두었습니다.</p>
}

function PageLoading() {
  return <div className="grid min-h-[28rem] place-items-center text-center"><div><LoaderCircle className="mx-auto animate-spin text-forest-600 dark:text-forest-100" size={34} /><p className="mt-3 text-sm text-[var(--muted)]">카드 결제 내역을 불러오는 중…</p></div></div>
}

function PageUnavailable({ missing, onRetry }: { missing: boolean; onRetry: () => void }) {
  return <section className="mx-auto max-w-[40rem] py-10 text-center"><h1 className="text-xl font-semibold">{missing ? '카드 결제 내역을 찾을 수 없어요' : '카드 결제 내역을 열지 못했어요'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{missing ? '삭제되었거나 이 가계부에서 볼 수 없는 결제 내역이에요.' : '잠시 후 다시 불러와 주세요.'}</p>{missing ? <Button asChild className="mt-5" variant="secondary"><Link to="/assets">자산 목록</Link></Button> : <Button className="mt-5" variant="secondary" onClick={onRetry}><RotateCcw size={17} />다시 불러오기</Button>}</section>
}

function snapshot(statement: CardStatementDetail): StatementSnapshot {
  return {
    statementId: statement.statementId,
    version: statement.version,
    remainingAmountWon: statement.remainingAmountWon,
    prepayableAmountWon: statement.prepayableAmountWon,
  }
}
