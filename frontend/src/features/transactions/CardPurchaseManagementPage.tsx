import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronDown, CreditCard, LoaderCircle, Pencil, RotateCcw, Save, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { MoneyField } from '../../components/ui/MoneyField'
import { DatePickerField } from '../../components/ui/DatePickerField'
import { StepIndicator } from '../../components/ui/StepIndicator'
import { Switch } from '../../components/ui/Switch'
import { CategoryPicker } from './CategoryPicker'
import './record-layout.css'
import './card-record-layout.css'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetApi, assetKeys, type Asset } from '../assets/api'
import { AssetPicker } from '../assets/AssetPicker'
import { categoryApi, categoryKeys, type Category } from '../categories/api'
import type { LedgerBook } from '../membership/api'
import {
  transactionApi,
  transactionKeys,
  type CardPurchaseAccountReturn,
  type CardPurchaseCorrectionInput,
  type CardPurchaseCorrectionPreview,
  type CardPurchaseManagementView,
  type CardPurchaseRefundInput,
  type CardPurchaseRefundPreview,
  type Transaction,
} from './api'
import { performerPersonLabel, performerQuestionLabel, performerSelectionError } from './performerLabels'
import { PerformerPicker } from './PerformerPicker'
import { TransactionActionLink, TransactionDetailLayout, TransactionDetailRow, TransactionHero, TransactionReflection, TransactionAudit } from './TransactionDetailLayout'

export type CardPurchaseAction = 'detail' | 'correction' | 'refund'

type CorrectionDraft = {
  occurredOn: string
  amountWon: string
  categoryId: string
  cardAssetId: string
  performedByMemberId: string
  description: string
  installmentCount: string
  excludedFromStatistics: boolean
  representativePayment: boolean
  statisticsAmountWon: string
}

type RefundDraft = {
  refundedOn: string
  amountWon: string
  description: string
  excludedFromStatistics: boolean
  statisticsAmountWon: string
}

type FieldErrors<T> = Partial<Record<keyof T, string>>
type Conflict = { latest: CardPurchaseManagementView }
type NavigationState = {
  returnTo?: string
  cardPurchaseCorrected?: boolean
  cardPurchaseRefunded?: boolean
}

export function CardPurchaseManagementPage({ ledger, action }: { ledger: LedgerBook; action: CardPurchaseAction }) {
  const { transactionId = '' } = useParams()
  const location = useLocation()
  const management = useQuery({
    queryKey: transactionKeys.cardPurchaseManagement(transactionId),
    queryFn: () => transactionApi.cardPurchaseManagement(transactionId),
    enabled: Boolean(transactionId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const assets = useQuery({
    queryKey: assetKeys.list,
    queryFn: assetApi.list,
    enabled: action === 'correction',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const categories = useQuery({
    queryKey: categoryKeys.list('EXPENSE'),
    queryFn: () => categoryApi.list('EXPENSE'),
    enabled: action === 'correction',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })

  if (management.isPending) return <AppShell ledgerNavigation><LoadingState label="카드 구매를 불러오는 중…" /></AppShell>
  if (management.isError || !management.data) {
    const missing = management.error instanceof ApiError && management.error.status === 404
    return <AppShell ledgerNavigation><UnavailableState missing={missing} onRetry={() => management.refetch()} /></AppShell>
  }

  const returnTo = safeReturnTo(location.state, management.data.purchase.occurredOn)
  if (action === 'correction') {
    return (
      <CorrectionPage
        key={transactionId}
        ledger={ledger}
        management={management.data}
        assets={assets.data ?? []}
        categories={categories.data ?? []}
        dependenciesPending={assets.isPending || categories.isPending}
        dependenciesError={assets.isError || categories.isError}
        onRetryDependencies={() => { void assets.refetch(); void categories.refetch() }}
        returnTo={returnTo}
      />
    )
  }
  if (action === 'refund') {
    return <RefundPage key={transactionId} management={management.data} returnTo={returnTo} />
  }
  return <CardPurchaseDetail management={management.data} returnTo={returnTo} state={location.state} />
}

function CardPurchaseDetail({ management, returnTo, state }: { management: CardPurchaseManagementView; returnTo: string; state: unknown }) {
  const purchase = management.purchase
  const navigation = state as NavigationState | null
  const status = navigation?.cardPurchaseCorrected
    ? '카드 구매 기록을 정정했어요. 관련 결제 내역과 계좌 장부도 다시 맞췄어요.'
    : navigation?.cardPurchaseRefunded
      ? '환불을 기록했어요. 미결제 금액과 원 결제 계좌 장부를 다시 맞췄어요.'
      : undefined
  return (
    <TransactionDetailLayout title="카드 구매 상세" returnTo={returnTo} actions={<div className="flex items-center" aria-label="기록 관리">
      <TransactionActionLink to={`/transactions/${purchase.transactionId}/card-purchase/correction`} returnTo={returnTo} label="기록 정정" icon={Pencil} />
    </div>}>
      <TransactionHero transaction={purchase} />
      {status ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">{status}</p> : null}
      <div className="td-columns"><PurchaseSummary management={management} /><TransactionReflection transaction={purchase}/></div>
      <BillingDetails management={management} returnTo={returnTo} />
      <TransactionAudit transaction={purchase}/>
    </TransactionDetailLayout>
  )
}

function CorrectionPage({ ledger, management, assets, categories, dependenciesPending, dependenciesError, onRetryDependencies, returnTo }: {
  ledger: LedgerBook
  management: CardPurchaseManagementView
  assets: Asset[]
  categories: Category[]
  dependenciesPending: boolean
  dependenciesError: boolean
  onRetryDependencies: () => void
  returnTo: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const { step, setStep, goToStep, stepTitle } = useCardRecordSteps(3)
  const purchase = management.purchase
  const [draft, setDraft] = useState<CorrectionDraft>(() => correctionDraft(management))
  const [baseVersion, setBaseVersion] = useState(purchase.version)
  const [errors, setErrors] = useState<FieldErrors<CorrectionDraft>>({})
  const [preview, setPreview] = useState<CardPurchaseCorrectionPreview>()
  const [conflict, setConflict] = useState<Conflict>()
  const [remoteMissing, setRemoteMissing] = useState(false)
  const errorSummary = useRef<HTMLParagraphElement>(null)
  const confirmationHeading = useRef<HTMLHeadingElement>(null)
  const idempotency = useRef<{ token: string; key: string } | undefined>(undefined)

  const previewMutation = useMutation({
    mutationFn: (input: CardPurchaseCorrectionInput) => transactionApi.previewCardPurchaseCorrection(purchase.transactionId, input),
    onSuccess: (result) => {
      setPreview(result)
      setBaseVersion(result.purchaseVersion)
      setConflict(undefined)
      idempotency.current = undefined
    },
    onError: (error) => void handleStale(error),
  })
  const applyMutation = useMutation({
    mutationFn: ({ input, key }: { input: CardPurchaseCorrectionInput & { previewToken: string }; key: string }) => transactionApi.applyCardPurchaseCorrection(purchase.transactionId, input, key),
    onSuccess: (saved) => {
      writeAuthoritativeCardPurchase(queryClient, saved)
      invalidateCardPurchaseQueries(queryClient)
      navigate(`/transactions/${purchase.transactionId}/card-purchase`, { replace: true, state: { returnTo, cardPurchaseCorrected: true } satisfies NavigationState })
    },
    onError: (error) => void handleStale(error),
  })

  async function handleStale(error: unknown) {
    if (!(error instanceof ApiError)) return
    if (error.status === 404) {
      setRemoteMissing(true)
      setPreview(undefined)
      return
    }
    if (error.status !== 412) return
    setPreview(undefined)
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: transactionKeys.cardPurchaseManagement(purchase.transactionId),
        queryFn: () => transactionApi.cardPurchaseManagement(purchase.transactionId),
        staleTime: 0,
      })
      setConflict({ latest })
    } catch (latestError) {
      if (latestError instanceof ApiError && latestError.status === 404) setRemoteMissing(true)
    }
  }

  function updateDraft<K extends keyof CorrectionDraft>(key: K, value: CorrectionDraft[K]) {
    if (previewMutation.isPending || applyMutation.isPending) return
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setPreview(undefined)
    previewMutation.reset()
    applyMutation.reset()
    idempotency.current = undefined
  }

  function requestPreview(expectedVersion = baseVersion) {
    const parsed = parseCorrection(draft, expectedVersion)
    setErrors(parsed.errors)
    if (!parsed.input) {
      goToStep(parsed.errors.occurredOn ? 1 : parsed.errors.categoryId || parsed.errors.cardAssetId ? 2 : 3)
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    previewMutation.mutate(parsed.input)
  }

  function applyCorrection() {
    if (!preview || !online || remoteMissing) return
    const parsed = parseCorrection(draft, baseVersion)
    setErrors(parsed.errors)
    if (!parsed.input) return
    idempotency.current = idempotency.current?.token === preview.previewToken
      ? idempotency.current
      : { token: preview.previewToken, key: crypto.randomUUID() }
    applyMutation.mutate({ input: { ...parsed.input, previewToken: preview.previewToken }, key: idempotency.current.key })
  }

  function closeConfirmation() {
    if (applyMutation.isPending) return
    setPreview(undefined)
    previewMutation.reset()
    applyMutation.reset()
    idempotency.current = undefined
  }

  function recalculateLatest() {
    if (!conflict) return
    setBaseVersion(conflict.latest.purchase.version)
    setConflict(undefined)
    requestPreview(conflict.latest.purchase.version)
  }

  const cardAssets = assets.filter((asset) => asset.behavior === 'CREDIT_CARD')
  const originalCardMissing = !cardAssets.some((asset) => asset.assetId === draft.cardAssetId)
  const pending = previewMutation.isPending || applyMutation.isPending
  return (
    <AppShell ledgerNavigation>
      <section className="transaction-record card-record-editor" data-record-step={step}>
        <Button asChild className="hidden md:inline-flex" variant="ghost"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}><ArrowLeft size={17} />카드 구매 상세</Link></Button>
        <header className="tr-desktop-title mt-4">
          <h1 className="text-2xl font-semibold tracking-[-.025em]">카드 구매 기록 정정</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">금액·날짜·분류 등 잘못 입력한 내용을 바로잡아요.</p>
        </header>
        <CardRecordProgress step={step} total={3} title="카드 구매 기록 정정" goToStep={goToStep} purchaseId={purchase.transactionId} returnTo={returnTo} disabled={pending}/>
        <h1 ref={stepTitle} tabIndex={-1} className="tr-mobile-title">{step===1?'구매 날짜를 확인해요':step===2?'분류와 카드를 확인해요':'금액과 내용을 바로잡아요'}</h1>
        <CompactPurchaseLine purchase={purchase} />
        {dependenciesPending ? <LoadingLine label="정정에 필요한 자산과 분류를 불러오는 중…" /> : null}
        {dependenciesError ? <InlineError message="자산 또는 분류를 불러오지 못했어요." action="다시 불러오기" onAction={onRetryDependencies} /> : null}
        {remoteMissing ? <RemoteMissing returnTo={returnTo} /> : null}
        <ConflictPanel conflict={conflict} onRecalculate={recalculateLatest}>
          {conflict ? <CorrectionChanges purchase={conflict.latest.purchase} draft={draft} assets={assets} categories={categories} ledger={ledger} /> : null}
        </ConflictPanel>
        <form className="mt-5" onSubmit={(event) => { event.preventDefault(); requestPreview() }} noValidate>
          {Object.values(errors).some(Boolean) ? <p ref={errorSummary} className="mb-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}
          <section className="tr-panel" data-record-panel="1" onFocusCapture={()=>setStep(1)} aria-label="거래 종류와 날짜">
            <p className="tr-fixed-type inline-flex items-center gap-2"><CreditCard size={17}/>카드 지출 <span className="text-[var(--muted)]">· 기록 정정</span></p>
            <DatePickerField id="correctionDate" label="구매 날짜" value={draft.occurredOn} onChange={value=>updateDraft('occurredOn',value)} error={errors.occurredOn} disabled={pending} required/>
          </section>
          <section className="tr-panel" data-record-panel="2" onFocusCapture={()=>setStep(2)} aria-label="분류와 카드">
            <CategoryPicker kind="EXPENSE" categories={categories} value={draft.categoryId} missingName={purchase.category?.name} onChange={value=>updateDraft('categoryId',value)} error={errors.categoryId} disabled={pending || dependenciesPending || dependenciesError} online={online}/>
            <AssetPicker id="correctionCard" label="결제 카드" assets={cardAssets} members={ledger.members} value={draft.cardAssetId} onChange={(value) => updateDraft('cardAssetId', value)} missingSelection={originalCardMissing ? { assetId: draft.cardAssetId, name: management.billingSnapshot.cardAssetName, assetTypeName: '신용카드' } : undefined} error={errors.cardAssetId} disabled={pending} required />
          </section>
          <section className="tr-panel" data-record-panel="3" onFocusCapture={()=>setStep(3)} aria-label="금액과 내용">
            <MoneyField id="correctionAmount" label="금액" value={draft.amountWon} onValueChange={value=>updateDraft('amountWon',value)} error={errors.amountWon} inputClassName="tr-amount" maxLength={13} disabled={pending} required/>
            <div className="tr-inline-options"><label><Switch aria-label="대표로 결제했어요" checked={draft.representativePayment} onCheckedChange={value=>updateDraft('representativePayment',value)} disabled={pending}/><span aria-hidden="true">대표 결제</span></label><label><Switch aria-label="지출에 포함하지 않기" checked={draft.excludedFromStatistics} onCheckedChange={value=>updateDraft('excludedFromStatistics',value)} disabled={pending}/><span aria-hidden="true">지출에 포함하지 않기</span></label></div>
            {draft.representativePayment ? <div className="tr-representative"><MoneyField id="correctionStatisticsAmount" label="지출로 반영할 금액" value={draft.statisticsAmountWon} onValueChange={value=>updateDraft('statisticsAmountWon',value)} inputClassName="tr-amount" maxLength={13} error={errors.statisticsAmountWon} disabled={pending} required hint="0원부터 실제 결제 금액까지 입력할 수 있어요."/></div>:null}
            <details className="tr-installment" key={errors.installmentCount ? 'invalid' : 'valid'} open={errors.installmentCount ? true : undefined}><summary>카드 결제 · {draft.installmentCount==='1'?'일시불':`${draft.installmentCount}개월 할부`}<ChevronDown size={14}/></summary><Field id="correctionInstallments" label="할부 개월" hint="일시불은 1개월로 두세요." type="number" min={1} max={60} inputMode="numeric" value={draft.installmentCount} onChange={event=>updateDraft('installmentCount',event.target.value)} error={errors.installmentCount} disabled={pending} required/></details>
            <CardDescription id="correctionDescription" value={draft.description} onChange={value=>updateDraft('description',value)} error={errors.description} disabled={pending}/>
          </section>
          <OfflineNotice online={online} />
          <MutationError error={previewMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="변경 영향을 계산하지 못했어요." />
          <footer className="tr-footer">
            <details className="tr-performer" key={errors.performedByMemberId ? 'invalid' : 'valid'} open={errors.performedByMemberId ? true : undefined}><summary><MemberAvatar displayName={ledger.members.find(member=>member.memberId===draft.performedByMemberId)?.displayName ?? '구성원'} memberId={draft.performedByMemberId} size="xs"/>쓴 사람 · {ledger.members.find(member=>member.memberId===draft.performedByMemberId)?.displayName ?? '선택'}<ChevronDown size={14}/></summary><PerformerPicker id="correctionPerformer" label={performerQuestionLabel('EXPENSE')} members={ledger.members} value={draft.performedByMemberId} onChange={value=>updateDraft('performedByMemberId',value)} error={errors.performedByMemberId} disabled={pending}/></details>
            <Button type="button" className="tr-next" disabled={pending || remoteMissing || dependenciesPending || dependenciesError} onClick={()=>{const parsed=parseCorrection(draft,baseVersion); const keys:(keyof CorrectionDraft)[]=step===1?['occurredOn']:['categoryId','cardAssetId']; const nextErrors=Object.fromEntries(keys.map(key=>[key,parsed.errors[key]])); setErrors(nextErrors); if(!Object.values(nextErrors).some(Boolean))goToStep(step+1)}}>다음</Button>
            <Button type="submit" className="tr-save" size="large" disabled={!online || pending || remoteMissing || Boolean(conflict) || dependenciesPending || dependenciesError}>{previewMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}정정 저장</Button>
          </footer>
        </form>
        <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) closeConfirmation() }}>
          {preview ? (
            <DialogContent
              className="left-1/2 top-auto bottom-[max(.5rem,env(safe-area-inset-bottom))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] w-[calc(100vw-2rem)] -translate-x-1/2 translate-y-0 md:top-1/2 md:bottom-auto md:w-[min(38rem,calc(100vw-3rem))] md:-translate-y-1/2 p-0 sm:p-0"
              aria-labelledby="correction-confirmation-title"
              aria-describedby="correction-confirmation-description"
              initialFocus={confirmationHeading}
            >
              <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
                <DialogHeader className="pb-2">
                  <DialogTitle ref={confirmationHeading} id="correction-confirmation-title" className="outline-none" tabIndex={-1}>정정 내용을 저장할까요?</DialogTitle>
                  <DialogDescription id="correction-confirmation-description">바뀌는 기록과 카드·계좌 장부 영향을 확인해 주세요.</DialogDescription>
                </DialogHeader>
                <div className="py-5">
                  <CorrectionChanges purchase={purchase} draft={draft} assets={assets} categories={categories} ledger={ledger} />
                  <AccountReturns returns={preview.accountReturns} unpaidCardReductionWon={preview.unpaidCardReductionWon} />
                  <MutationError error={applyMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="정정을 저장하지 못했어요." />
                </div>
                <DialogFooter className="grid grid-cols-2 gap-3 pt-4 sm:flex">
                  <Button type="button" variant="secondary" size="large" disabled={applyMutation.isPending} onClick={closeConfirmation}>취소</Button>
                  <Button type="button" size="large" disabled={!online || applyMutation.isPending} onClick={applyCorrection}>
                    {applyMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}저장
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          ) : null}
        </Dialog>
      </section>
    </AppShell>
  )
}

function RefundPage({ management, returnTo }: { management: CardPurchaseManagementView; returnTo: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const { step, setStep, goToStep, stepTitle } = useCardRecordSteps(2)
  const purchase = management.purchase
  const [draft, setDraft] = useState<RefundDraft>(() => ({
    refundedOn: todayInSeoul(),
    amountWon: String(management.refundableAmountWon),
    statisticsAmountWon: String(remainingRefundStatisticsAmount(management)),
    description: '',
    excludedFromStatistics: purchase.excludedFromStatistics,
  }))
  const [baseVersion, setBaseVersion] = useState(purchase.version)
  const [errors, setErrors] = useState<FieldErrors<RefundDraft>>({})
  const [preview, setPreview] = useState<CardPurchaseRefundPreview>()
  const [conflict, setConflict] = useState<Conflict>()
  const [remoteMissing, setRemoteMissing] = useState(false)
  const errorSummary = useRef<HTMLParagraphElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const idempotency = useRef<{ token: string; key: string } | undefined>(undefined)

  useEffect(() => {
    if (preview) previewHeading.current?.focus()
  }, [preview])

  const previewMutation = useMutation({
    mutationFn: (input: CardPurchaseRefundInput) => transactionApi.previewCardPurchaseRefund(purchase.transactionId, input),
    onSuccess: (result) => {
      setPreview(result)
      setBaseVersion(result.purchaseVersion)
      setConflict(undefined)
      idempotency.current = undefined
    },
    onError: (error) => void handleStale(error),
  })
  const applyMutation = useMutation({
    mutationFn: ({ input, key }: { input: CardPurchaseRefundInput & { previewToken: string }; key: string }) => transactionApi.applyCardPurchaseRefund(purchase.transactionId, input, key),
    onSuccess: async (result) => {
      queryClient.setQueryData(transactionKeys.detail(result.purchase.transactionId), result.purchase)
      queryClient.setQueryData(transactionKeys.detail(result.refundTransaction.transactionId), result.refundTransaction)
      invalidateCardPurchaseQueries(queryClient)
      try {
        const latest = await transactionApi.cardPurchaseManagement(purchase.transactionId)
        writeAuthoritativeCardPurchase(queryClient, latest)
      } catch {
        // Invalidated queries refetch on the destination even if this eager refresh is unavailable.
      }
      navigate(`/transactions/${purchase.transactionId}/card-purchase`, { replace: true, state: { returnTo, cardPurchaseRefunded: true } satisfies NavigationState })
    },
    onError: (error) => void handleStale(error),
  })

  async function handleStale(error: unknown) {
    if (!(error instanceof ApiError)) return
    if (error.status === 404) {
      setRemoteMissing(true)
      setPreview(undefined)
      return
    }
    if (error.status !== 412) return
    setPreview(undefined)
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: transactionKeys.cardPurchaseManagement(purchase.transactionId),
        queryFn: () => transactionApi.cardPurchaseManagement(purchase.transactionId),
        staleTime: 0,
      })
      setConflict({ latest })
    } catch (latestError) {
      if (latestError instanceof ApiError && latestError.status === 404) setRemoteMissing(true)
    }
  }

  function updateDraft<K extends keyof RefundDraft>(key: K, value: RefundDraft[K]) {
    if (previewMutation.isPending || applyMutation.isPending) return
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setPreview(undefined)
    previewMutation.reset()
    applyMutation.reset()
    idempotency.current = undefined
  }

  function updateRefundAmount(value: string) {
    if (purchase.statisticsAmountWon === purchase.amountWon) {
      setDraft((current) => ({ ...current, amountWon: value, statisticsAmountWon: value }))
      setErrors((current) => ({ ...current, amountWon: undefined, statisticsAmountWon: undefined }))
      setPreview(undefined)
      previewMutation.reset()
      applyMutation.reset()
      idempotency.current = undefined
      return
    }
    updateDraft('amountWon', value)
  }

  function requestPreview(expectedVersion = baseVersion) {
    const latest = conflict?.latest ?? management
    const parsed = parseRefund(draft, expectedVersion, latest.refundableAmountWon, remainingRefundStatisticsAmount(latest))
    setErrors(parsed.errors)
    if (!parsed.input) {
      goToStep(parsed.errors.refundedOn ? 1 : 2)
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    previewMutation.mutate(parsed.input)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || !online || remoteMissing) return
    const parsed = parseRefund(draft, baseVersion, preview.refundableAmountWon, remainingRefundStatisticsAmount(management))
    setErrors(parsed.errors)
    if (!parsed.input) return
    idempotency.current = idempotency.current?.token === preview.previewToken
      ? idempotency.current
      : { token: preview.previewToken, key: crypto.randomUUID() }
    applyMutation.mutate({ input: { ...parsed.input, previewToken: preview.previewToken }, key: idempotency.current.key })
  }

  function recalculateLatest() {
    if (!conflict) return
    setBaseVersion(conflict.latest.purchase.version)
    setConflict(undefined)
    requestPreview(conflict.latest.purchase.version)
  }

  const pending = previewMutation.isPending || applyMutation.isPending
  return (
    <AppShell ledgerNavigation>
      <section className="transaction-record card-record-editor refund-record" data-record-step={step}>
        <Button asChild className="hidden md:inline-flex" variant="ghost"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}><ArrowLeft size={17} />카드 구매 상세</Link></Button>
        <header className="tr-desktop-title mt-4">
          <h1 className="text-2xl font-semibold tracking-[-.025em]">카드 구매 환불</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">실제로 돌려받은 금액을 기록해요.</p>
        </header>
        <CardRecordProgress step={step} total={2} title="카드 구매 환불" goToStep={goToStep} purchaseId={purchase.transactionId} returnTo={returnTo} disabled={pending}/>
        <h1 ref={stepTitle} tabIndex={-1} className="tr-mobile-title">{step===1?'언제 환불받았나요?':'얼마를 환불받았나요?'}</h1>
        <CompactPurchaseLine purchase={purchase} />
        <p className="mt-4 text-sm text-[var(--muted)]">현재 환불 가능 금액 <strong className="text-ink-900 dark:text-white">{formatWon(conflict?.latest.refundableAmountWon ?? management.refundableAmountWon)}</strong></p>
        {remoteMissing ? <RemoteMissing returnTo={returnTo} /> : null}
        <ConflictPanel conflict={conflict} onRecalculate={recalculateLatest}>
          {conflict ? <dl className="mt-3 grid gap-2 text-sm min-[30rem]:grid-cols-2"><Value label="최신 환불 가능 금액" value={formatWon(conflict.latest.refundableAmountWon)} /><Value label="내가 입력한 환불 금액" value={formatWon(parseWon(draft.amountWon) ?? 0)} /></dl> : null}
        </ConflictPanel>
        {management.refundableAmountWon <= 0 ? <NoRefundAvailable returnTo={returnTo} purchaseId={purchase.transactionId} /> : <form className="mt-5" onSubmit={submit} noValidate>
          {Object.values(errors).some(Boolean) ? <p ref={errorSummary} className="mb-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}
          <section className="tr-panel" data-record-panel="1" onFocusCapture={()=>setStep(1)} aria-label="환불 날짜">
            <p className="tr-fixed-type inline-flex items-center gap-2"><Undo2 size={17}/>카드 환불</p>
            <DatePickerField id="refundDate" label="환불일" value={draft.refundedOn} onChange={value=>updateDraft('refundedOn',value)} error={errors.refundedOn} disabled={pending} required/>
            <p className="text-xs leading-6 text-[var(--muted)]">판매처에서 실제로 환불받은 날짜를 선택해 주세요. 원 구매 기록은 그대로 남아요.</p>
          </section>
          <section className="tr-panel" data-record-panel="2" onFocusCapture={()=>setStep(2)} aria-label="환불 금액과 내용">
            <MoneyField id="refundAmount" label="환불 금액" value={draft.amountWon} onValueChange={updateRefundAmount} inputClassName="tr-amount" maxLength={13} error={errors.amountWon} disabled={pending} required/>
            <div className="tr-inline-options"><label><Switch aria-label="지출에 포함하지 않기" checked={draft.excludedFromStatistics} onCheckedChange={value=>updateDraft('excludedFromStatistics',value)} disabled={pending}/><span aria-hidden="true">지출에 포함하지 않기</span></label></div>
            {purchase.statisticsAmountWon !== purchase.amountWon ? <div className="tr-representative"><MoneyField id="refundStatisticsAmount" inputClassName="tr-amount" maxLength={13} label="지출에서 차감할 금액" value={draft.statisticsAmountWon} onValueChange={value=>updateDraft('statisticsAmountWon',value)} hint={`남은 지출 반영액 ${formatWon(remainingRefundStatisticsAmount(conflict?.latest ?? management))} 이하로 입력해 주세요.`} error={errors.statisticsAmountWon} disabled={pending} required/></div> : null}
            {draft.excludedFromStatistics ? <p className="text-xs leading-6 text-[var(--muted)]">자산 잔액은 바뀌지만 달력과 통계 합계에는 반영하지 않아요.</p> : null}
            <CardDescription id="refundDescription" value={draft.description} onChange={value=>updateDraft('description',value)} error={errors.description} disabled={pending}/>
          </section>
          <OfflineNotice online={online} />
          <MutationError error={previewMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="환불 반영 내용을 계산하지 못했어요." />
          <MutationError error={applyMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="환불을 기록하지 못했어요." />
          <div className="card-record-actions">
            <Button type="button" className="tr-next" disabled={pending || remoteMissing} onClick={()=>{if(!draft.refundedOn){setErrors({refundedOn:'환불일을 선택해 주세요.'});return}goToStep(2)}}>다음</Button>
            {applyMutation.isPending ? <Button type="button" variant="secondary" size="large" disabled>취소</Button> : <Button asChild variant="secondary" size="large"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}>취소</Link></Button>}
            <Button type="button" className="refund-confirm" size="large" onClick={() => requestPreview()} disabled={!online || pending || remoteMissing || Boolean(conflict) || (conflict?.latest.refundableAmountWon ?? management.refundableAmountWon) <= 0}>{previewMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}환불 내용 확인</Button>
          </div>
          {preview ? (
            <ImpactPreview ref={previewHeading} title="환불 반영 내용" preview={preview}>
              <dl className="mt-4 grid gap-2 text-sm min-[30rem]:grid-cols-2">
                <Value label="환불일" value={draft.refundedOn} />
                <Value label="달력·통계" value={draft.excludedFromStatistics ? '집계 제외' : `지출에서 +${formatWon(parseNonNegativeWon(draft.statisticsAmountWon) ?? 0)} 차감`} />
              </dl>
              <Button type="submit" className="mt-5 w-full min-[22.5rem]:w-auto" size="large" disabled={!online || applyMutation.isPending}>
                {applyMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}환불 기록
              </Button>
            </ImpactPreview>
          ) : null}
        </form>}
      </section>
    </AppShell>
  )
}

function PurchaseSummary({ management }: { management: CardPurchaseManagementView }) {
  const purchase = management.purchase
  return <section className="td-information" aria-label="거래 정보"><h2>거래 정보</h2><dl>
    <TransactionDetailRow label="분류" value={purchase.category?.name ?? '분류 없음'}/>
    <TransactionDetailRow label="결제 자산" value={<><CreditCard size={17} aria-hidden="true"/><Link to={`/assets/${management.billingSnapshot.cardAssetId}`}>{management.billingSnapshot.cardAssetName}</Link></>}/>
    <TransactionDetailRow label={performerPersonLabel('EXPENSE')} value={purchase.performedBy ? <><MemberAvatar displayName={purchase.performedBy.displayName} memberId={purchase.performedBy.memberId} size="xs"/>{purchase.performedBy.displayName}</> : '구성원 없음'}/>
    <TransactionDetailRow label="결제 방식" value={management.billingSnapshot.installmentCount > 1 ? `${management.billingSnapshot.installmentCount}개월 할부` : '일시불'}/>
  </dl></section>
}

function BillingDetails({ management, returnTo }: { management: CardPurchaseManagementView; returnTo: string }) {
  return (
    <details className="td-disclosure"><summary><span>카드 청구·환불 내역<small>{management.billingSnapshot.installmentCount > 1 ? `${management.billingSnapshot.installmentCount}개월 할부` : '일시불'} · {management.refunds.length ? `환불 ${management.refunds.length}건` : '환불 기록 없음'}</small></span><ChevronDown size={17} aria-hidden="true"/></summary>
    <section className="td-disclosure-body" aria-labelledby="billing-details-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="billing-details-title" className="text-lg font-semibold">결제와 환불 내역</h2>
        <span className="text-sm text-[var(--muted)]">환불 가능 {formatWon(management.refundableAmountWon)}</span>
      </div>
      {management.refundableAmountWon > 0 ? <Button asChild className="my-3" variant="secondary"><Link to={`/transactions/${management.purchase.transactionId}/card-purchase/refund`} state={{ returnTo }}><Undo2 size={15}/>환불 처리</Link></Button> : null}
      <p className="mt-2 text-sm text-[var(--muted)]">매월 {management.billingSnapshot.statementClosingDay}일 정산 · {paymentMonthLabel(management.billingSnapshot.paymentMonthOffset)} {management.billingSnapshot.paymentDay}일 결제</p>
      {management.charges.length ? (
        <section className="mt-4" aria-labelledby="charge-schedule-title">
          <h3 id="charge-schedule-title" className="font-semibold">할부·청구 일정</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {management.charges.map((charge) => <li className="grid gap-1 py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]" key={charge.chargeId}><span>{charge.installmentNo}/{charge.installmentCount}회 · {charge.expectedSettlementOn}</span><span className="font-semibold tabular-nums">환불 가능 {formatWon(charge.refundableAmountWon)}</span></li>)}
          </ul>
        </section>
      ) : null}
      <div className="mt-4 space-y-3">
        {management.statements.length ? management.statements.map((statement) => (
          <section className="rounded-xl bg-[var(--surface)] p-4" aria-labelledby={`statement-${statement.statementId}`} key={statement.statementId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`statement-${statement.statementId}`} className="font-semibold">{statement.dueOn} 결제</h3>
              <span className="text-xs text-[var(--muted)]">{statementStatusLabel(statement.status)}</span>
            </div>
            <dl className="mt-2 grid gap-2 text-sm min-[30rem]:grid-cols-3">
              <Value label="청구 원금" value={formatWon(statement.grossAmountWon)} />
              <Value label="결제 완료" value={formatWon(statement.paidAmountWon)} />
              <Value label="남은 결제" value={formatWon(statement.paymentAmountWon)} />
            </dl>
            <Button asChild className="mt-3" variant="ghost"><Link to={`/assets/${management.billingSnapshot.cardAssetId}/card-statements/${statement.statementId}`}>카드 결제 내역 보기</Link></Button>
            {statement.payments.length ? <ul className="mt-3 space-y-2 text-sm">{statement.payments.map((payment) => <li className="grid gap-1 py-3 min-[30rem]:grid-cols-[1fr_auto]" key={payment.paymentId}><span>{payment.settlementAssetName} · {payment.paidOn}</span><span className="font-semibold tabular-nums">결제 {formatWon(payment.amountWon)}{payment.returnedAmountWon > 0 ? ` · 반환 ${formatWon(payment.returnedAmountWon)}` : ''}</span></li>)}</ul> : <p className="mt-3 text-sm text-[var(--muted)]">아직 결제 기록이 없어요.</p>}
          </section>
        )) : <p className="py-5 text-sm text-[var(--muted)]">연결된 카드 결제 내역이 없어요.</p>}
      </div>
      {management.refunds.length ? (
        <section className="mt-6" aria-labelledby="refund-history-title">
          <h3 id="refund-history-title" className="font-semibold">환불 처리 내역</h3>
          <ul className="mt-2 space-y-2">{management.refunds.map((refund) => <li className="py-3 text-sm" key={refund.refundId}><div className="flex flex-wrap justify-between gap-2"><span>{refund.refundedOn}{refund.excludedFromStatistics ? ' · 집계 제외' : refund.statisticsAmountWon !== refund.amountWon ? ` · 지출 ${formatWon(refund.statisticsAmountWon)} 차감` : ''}</span><strong>+{formatWon(refund.amountWon)}</strong></div><AccountReturns returns={refund.accountReturns} unpaidCardReductionWon={refund.unpaidCardReductionWon} /></li>)}</ul>
        </section>
      ) : null}
    </section></details>
  )
}

function CompactPurchaseLine({ purchase }: { purchase: Transaction }) {
  return <p className="card-original-purchase"><span className="text-[var(--muted)]">원 구매 </span><strong>{purchase.occurredOn} · {formatWon(purchase.amountWon)}</strong><span className="text-[var(--muted)]"> · {purchase.description || purchase.category?.name || '카드 구매'}</span></p>
}

function NoRefundAvailable({ returnTo, purchaseId }: { returnTo: string; purchaseId: string }) {
  return <section className="mt-5 border-y border-[var(--line)] py-6"><h2 className="font-semibold">환불할 수 있는 금액이 없어요</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">이 구매의 전체 금액이 이미 환불 처리됐어요. 원 구매와 기존 환불 내역은 상세에서 확인할 수 있어요.</p><Button asChild className="mt-4" variant="secondary"><Link to={`/transactions/${purchaseId}/card-purchase`} state={{ returnTo }}>카드 구매 상세</Link></Button></section>
}

const ImpactPreview = function ImpactPreview({ ref, title, preview, children }: { ref: Ref<HTMLHeadingElement>; title: string; preview: CardPurchaseCorrectionPreview | CardPurchaseRefundPreview; children: ReactNode }) {
  return (
    <section className="card-impact-preview" aria-labelledby="card-purchase-impact-title">
      <h2 ref={ref} id="card-purchase-impact-title" className="text-lg font-semibold outline-none" tabIndex={-1}>{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">장부에서 카드와 실제 원 결제 계좌 내역을 함께 맞춥니다.</p>
      {children}
      <AccountReturns returns={preview.accountReturns} unpaidCardReductionWon={preview.unpaidCardReductionWon} />
    </section>
  )
}

function AccountReturns({ returns, unpaidCardReductionWon }: { returns: CardPurchaseAccountReturn[]; unpaidCardReductionWon: number }) {
  return (
    <dl className="mt-4 rounded-xl bg-[var(--surface)] px-4 py-2 text-sm">
      <div className="grid gap-1 py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]"><dt>미결제 카드 금액 감소</dt><dd className="font-semibold tabular-nums">{formatWon(unpaidCardReductionWon)}</dd></div>
      {returns.map((accountReturn) => <div className="grid gap-1 py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]" key={`${accountReturn.assetId}-${accountReturn.amountWon}`}><dt>{accountReturn.assetName} 장부 반환</dt><dd className="font-semibold tabular-nums">{formatWon(accountReturn.amountWon)}</dd></div>)}
      {!returns.length ? <div className="py-3 text-[var(--muted)]">원 결제 계좌에 반환 기록할 금액이 없어요.</div> : null}
    </dl>
  )
}

function CorrectionChanges({ purchase, draft, assets, categories, ledger }: { purchase: Transaction; draft: CorrectionDraft; assets: Asset[]; categories: Category[]; ledger: LedgerBook }) {
  const cardName = assets.find((asset) => asset.assetId === draft.cardAssetId)?.name ?? draft.cardAssetId
  const categoryName = categories.find((category) => category.categoryId === draft.categoryId)?.name ?? draft.categoryId
  const performerName = ledger.members.find((member) => member.memberId === draft.performedByMemberId)?.displayName ?? draft.performedByMemberId
  const changes = [
    ['구매 날짜', purchase.occurredOn, draft.occurredOn],
    ['금액', formatWon(purchase.amountWon), formatWon(parseWon(draft.amountWon) ?? 0)],
    ['지출 반영 금액', formatWon(purchase.statisticsAmountWon), formatWon(draft.representativePayment ? parseNonNegativeWon(draft.statisticsAmountWon) ?? 0 : parseWon(draft.amountWon) ?? 0)],
    ['분류', purchase.category?.name ?? '분류 없음', categoryName],
    ['결제 카드', purchase.asset?.name ?? '카드', cardName],
    [performerPersonLabel('EXPENSE'), purchase.performedBy?.displayName ?? '구성원 없음', performerName],
    ['할부', `${purchase.installmentCount ?? 1}개월`, `${draft.installmentCount}개월`],
    ['달력·통계', purchase.excludedFromStatistics ? '집계 제외' : '지출에 포함', draft.excludedFromStatistics ? '집계 제외' : '지출에 포함'],
    ['내용', purchase.description || '내용 없음', draft.description || '내용 없음'],
  ].filter(([, before, after]) => before !== after)
  return changes.length ? <dl className="mt-4 space-y-2 text-sm">{changes.map(([label, before, after]) => <div className="grid gap-1 py-3 min-[30rem]:grid-cols-[7rem_minmax(0,1fr)_auto]" key={label}><dt className="font-semibold">{label}</dt><dd className="min-w-0 break-words text-[var(--muted)]">{before}</dd><dd className="min-w-0 break-words font-semibold min-[30rem]:text-right">→ {after}</dd></div>)}</dl> : <p className="mt-4 text-sm text-[var(--muted)]">입력한 값은 기존 구매 기록과 같아요.</p>
}

function ConflictPanel({ conflict, onRecalculate, children }: { conflict?: Conflict; onRecalculate: () => void; children?: ReactNode }) {
  if (!conflict) return null
  return (
    <section className="mt-5 border-l-4 border-amber-500 px-4 py-2" role="alert" aria-labelledby="card-purchase-conflict-title">
      <h2 id="card-purchase-conflict-title" className="font-semibold">다른 구성원이 카드 구매 또는 결제 내역을 먼저 변경했어요</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">입력은 그대로 두었고 이전 영향 확인은 폐기했습니다. 최신값으로 영향을 다시 계산해야 적용할 수 있어요.</p>
      {children}
      <Button className="mt-3" type="button" onClick={onRecalculate}><RotateCcw size={17} />최신값으로 영향 다시 계산</Button>
    </section>
  )
}

function RemoteMissing({ returnTo }: { returnTo: string }) {
  return <section className="mt-5 border-l-4 border-red-600 px-4 py-2" role="alert"><h2 className="font-semibold">원 카드 구매를 찾을 수 없어요</h2><p className="mt-1 text-sm text-[var(--muted)]">입력은 이 화면에 남아 있지만 더 이상 적용할 수 없어요.</p><Button asChild className="mt-3" variant="secondary"><Link to={returnTo}>가계부로 돌아가기</Link></Button></section>
}

function OfflineNotice({ online }: { online: boolean }) {
  return online ? null : <p className="mt-5 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">인터넷 연결을 확인해 주세요. 입력은 그대로 두었고 연결되면 영향을 확인할 수 있어요.</p>
}

function MutationError({ error, hidden, fallback }: { error: unknown; hidden: boolean; fallback: string }) {
  if (!error || hidden) return null
  return <p className="mt-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : fallback} 입력은 그대로 두었습니다.</p>
}

function InlineError({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return <div className="mt-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert"><p>{message}</p><Button className="mt-3" type="button" variant="secondary" onClick={onAction}>{action}</Button></div>
}

function LoadingLine({ label }: { label: string }) {
  return <p className="mt-5 inline-flex items-center gap-2 text-sm text-[var(--muted)]" role="status"><LoaderCircle className="animate-spin" size={17} />{label}</p>
}

function CardDescription({ id, value, onChange, error, disabled }: { id:string; value:string; onChange:(value:string)=>void; error?:string; disabled:boolean }) {
  return <div className="relative"><Field id={id} label="내용 (선택)" value={value} onChange={event=>onChange(event.target.value)} maxLength={40} placeholder="짧게 남겨요" error={error} disabled={disabled}/><span className="absolute right-0 top-0 text-[13px] tabular-nums text-[var(--muted)]">{value.length}/40</span>{value.length>40?<p className="mt-2 text-xs text-[var(--muted)]">기존 내용은 보존했어요. 변경할 때는 40자 이내로 입력해 주세요.</p>:null}</div>
}

function useCardRecordSteps(total:number) {
  const [step,setStep]=useState(1)
  const stepTitle=useRef<HTMLHeadingElement>(null)
  function goToStep(value:number) { setStep(Math.max(1,Math.min(value,total))); requestAnimationFrame(()=>{if(stepTitle.current?.getClientRects().length)stepTitle.current.focus()}) }
  return {step,setStep,goToStep,stepTitle}
}

function CardRecordProgress({step,total,title,goToStep,purchaseId,returnTo,disabled}:{step:number;total:number;title:string;goToStep:(step:number)=>void;purchaseId:string;returnTo:string;disabled:boolean}) {
  return <div className="tr-mobile-progress">{step===1?<Button asChild variant="ghost" size="icon"><Link aria-label="카드 구매 상세" to={`/transactions/${purchaseId}/card-purchase`} state={{returnTo}}><ArrowLeft size={19}/></Link></Button>:<Button type="button" variant="ghost" size="icon" aria-label="이전 단계" disabled={disabled} onClick={()=>goToStep(step-1)}><ArrowLeft size={19}/></Button>}<span>{title}</span><StepIndicator step={step} total={total} label={`${title} 진행`}/></div>
}

function Value({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return <div className={className}><dt className="text-[var(--muted)]">{label}</dt><dd className="mt-0.5 min-w-0 break-words font-semibold">{value}</dd></div>
}

function LoadingState({ label }: { label: string }) {
  return <div className="grid min-h-[70dvh] place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />{label}</span></div>
}

function UnavailableState({ missing, onRetry }: { missing: boolean; onRetry: () => void }) {
  return <section className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">{missing ? '카드 구매를 찾을 수 없어요' : '카드 구매를 불러오지 못했어요'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{missing ? '다른 구성원의 변경으로 기록이 없어졌거나 주소가 올바르지 않을 수 있어요.' : '연결을 확인한 뒤 다시 시도해 주세요.'}</p>{missing ? <Button asChild className="mt-5"><Link to="/">가계부로 돌아가기</Link></Button> : <Button className="mt-5" variant="secondary" onClick={onRetry}>다시 불러오기</Button>}</section>
}

function correctionDraft(management: CardPurchaseManagementView): CorrectionDraft {
  const purchase = management.purchase
  return {
    occurredOn: purchase.occurredOn,
    amountWon: String(purchase.amountWon),
    categoryId: purchase.category?.categoryId ?? '',
    cardAssetId: purchase.asset?.assetId ?? management.billingSnapshot.cardAssetId,
    performedByMemberId: purchase.performedBy?.memberId ?? '',
    description: purchase.description ?? '',
    installmentCount: String(purchase.installmentCount ?? management.billingSnapshot.installmentCount),
    excludedFromStatistics: purchase.excludedFromStatistics,
    representativePayment: purchase.statisticsAmountWon !== purchase.amountWon,
    statisticsAmountWon: String(purchase.statisticsAmountWon),
  }
}

function parseCorrection(draft: CorrectionDraft, expectedVersion: number): { input?: CardPurchaseCorrectionInput; errors: FieldErrors<CorrectionDraft> } {
  const errors: FieldErrors<CorrectionDraft> = {}
  const amountWon = parseWon(draft.amountWon)
  const installmentCount = Number(draft.installmentCount)
  if (!amountWon) errors.amountWon = '0원보다 큰 원 단위 정수를 입력해 주세요.'
  if (!draft.occurredOn) errors.occurredOn = '구매 날짜를 선택해 주세요.'
  if (!draft.categoryId) errors.categoryId = '분류를 선택해 주세요.'
  if (!draft.cardAssetId) errors.cardAssetId = '결제 카드를 선택해 주세요.'
  if (!draft.performedByMemberId) errors.performedByMemberId = performerSelectionError('EXPENSE')
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60) errors.installmentCount = '1개월부터 60개월 사이로 입력해 주세요.'
  const statisticsAmountWon = draft.representativePayment
    ? parseNonNegativeWon(draft.statisticsAmountWon)
    : amountWon
  if (statisticsAmountWon === undefined || (amountWon !== undefined && statisticsAmountWon > amountWon)) errors.statisticsAmountWon = '0원 이상 실제 결제 금액 이하로 입력해 주세요.'
  if (Object.values(errors).some(Boolean) || !amountWon || statisticsAmountWon === undefined) return { errors }
  return { errors, input: { occurredOn: draft.occurredOn, amountWon, statisticsAmountWon, categoryId: draft.categoryId, cardAssetId: draft.cardAssetId, performedByMemberId: draft.performedByMemberId, installmentCount, expectedVersion, excludedFromStatistics: draft.excludedFromStatistics, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) } }
}

function parseRefund(draft: RefundDraft, expectedVersion: number, refundableAmountWon: number, remainingStatisticsAmountWon: number): { input?: CardPurchaseRefundInput; errors: FieldErrors<RefundDraft> } {
  const errors: FieldErrors<RefundDraft> = {}
  const amountWon = parseWon(draft.amountWon)
  const statisticsAmountWon = parseNonNegativeWon(draft.statisticsAmountWon)
  if (!amountWon) errors.amountWon = '0원보다 큰 원 단위 정수를 입력해 주세요.'
  else if (amountWon > refundableAmountWon) errors.amountWon = `현재 환불 가능 금액 ${formatWon(refundableAmountWon)} 이하로 입력해 주세요.`
  if (statisticsAmountWon === undefined || (amountWon !== undefined && statisticsAmountWon > amountWon)) errors.statisticsAmountWon = '0원 이상 환불 금액 이하로 입력해 주세요.'
  else if (statisticsAmountWon > remainingStatisticsAmountWon) errors.statisticsAmountWon = `남은 지출 반영액 ${formatWon(remainingStatisticsAmountWon)} 이하로 입력해 주세요.`
  if (!draft.refundedOn) errors.refundedOn = '환불일을 선택해 주세요.'
  if (Object.values(errors).some(Boolean) || !amountWon || statisticsAmountWon === undefined) return { errors }
  return { errors, input: { refundedOn: draft.refundedOn, amountWon, statisticsAmountWon, expectedVersion, excludedFromStatistics: draft.excludedFromStatistics, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) } }
}

function writeAuthoritativeCardPurchase(queryClient: ReturnType<typeof useQueryClient>, management: CardPurchaseManagementView) {
  queryClient.setQueryData(transactionKeys.cardPurchaseManagement(management.purchase.transactionId), management)
  queryClient.setQueryData(transactionKeys.detail(management.purchase.transactionId), management.purchase)
}

function invalidateCardPurchaseQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
  void queryClient.invalidateQueries({ queryKey: assetKeys.all })
  void queryClient.invalidateQueries({ queryKey: categoryKeys.all })
}

function parseWon(value: string) {
  const amount = Number(value.replaceAll(',', '').trim())
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined
}

function parseNonNegativeWon(value: string) {
  const amount = Number(value.replaceAll(',', '').trim())
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined
}

function remainingRefundStatisticsAmount(management: CardPurchaseManagementView) {
  return Math.max(0, management.purchase.statisticsAmountWon
    - management.refunds.reduce((sum, refund) => sum + refund.statisticsAmountWon, 0))
}

function safeReturnTo(state: unknown, occurredOn: string) {
  const value = (state as NavigationState | null)?.returnTo
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : `/?view=daily&month=${occurredOn.slice(0, 7)}`
}

function formatWon(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원`
}

function paymentMonthLabel(offset: number) {
  return offset === 0 ? '당월' : offset === 1 ? '다음 달' : `${offset}개월 뒤`
}

function statementStatusLabel(status: string) {
  return ({ OPEN: '예정', FINALIZED: '확정', PAID: '결제 완료', CANCELLED: '취소' } as Record<string, string>)[status] ?? '확인 필요'
}

function todayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
