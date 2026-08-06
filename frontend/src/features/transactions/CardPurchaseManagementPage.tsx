import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, LoaderCircle, RotateCcw, Save } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { MoneyField } from '../../components/ui/MoneyField'
import { SelectField } from '../../components/ui/SelectField'
import { TextareaField } from '../../components/ui/TextareaField'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetApi, assetKeys, type Asset } from '../assets/api'
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
import { StatisticsExclusionSwitch } from './StatisticsExclusionSwitch'

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
}

type RefundDraft = {
  refundedOn: string
  amountWon: string
  description: string
  excludedFromStatistics: boolean
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
    ? '카드 구매 기록을 정정했어요. 관련 명세와 계좌 장부도 다시 맞췄어요.'
    : navigation?.cardPurchaseRefunded
      ? '환불을 기록했어요. 미결제 금액과 원 결제 계좌 장부를 다시 맞췄어요.'
      : undefined
  return (
    <AppShell ledgerNavigation>
      <section className="mx-auto max-w-[52rem] py-5 md:py-8">
        <Button asChild variant="ghost"><Link to={returnTo}><ArrowLeft size={17} />가계부로 돌아가기</Link></Button>
        <header className="mt-4 border-b border-[var(--line)] pb-4">
          <h1 className="text-2xl font-semibold tracking-[-.025em]">카드 구매 상세</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">구매 기록과 카드 명세·결제 내역을 함께 확인할 수 있어요.</p>
        </header>
        {status ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">{status}</p> : null}
        <PurchaseSummary management={management} />
        <BillingDetails management={management} />
        <section className="mt-8 border-t border-[var(--line)]" aria-labelledby="card-purchase-actions-title">
          <h2 id="card-purchase-actions-title" className="py-4 text-lg font-semibold">관리</h2>
          <ActionRow
            title="기록 정정"
            description="날짜나 금액처럼 입력한 구매 기록이 잘못되었을 때 원 구매일 기준으로 다시 맞춥니다."
            to={`/transactions/${purchase.transactionId}/card-purchase/correction`}
            returnTo={returnTo}
          />
          {management.refundableAmountWon > 0 ? (
            <ActionRow
              title="환불 처리"
              description="판매처에서 실제로 환불받았을 때 환불일에 기록합니다. 원 구매 기록은 그대로 남습니다."
              to={`/transactions/${purchase.transactionId}/card-purchase/refund`}
              returnTo={returnTo}
            />
          ) : <UnavailableActionRow title="환불 처리" description="환불할 수 있는 금액이 남아 있지 않아요." />}
        </section>
      </section>
    </AppShell>
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
  const purchase = management.purchase
  const [draft, setDraft] = useState<CorrectionDraft>(() => correctionDraft(management))
  const [baseVersion, setBaseVersion] = useState(purchase.version)
  const [errors, setErrors] = useState<FieldErrors<CorrectionDraft>>({})
  const [preview, setPreview] = useState<CardPurchaseCorrectionPreview>()
  const [conflict, setConflict] = useState<Conflict>()
  const [remoteMissing, setRemoteMissing] = useState(false)
  const errorSummary = useRef<HTMLParagraphElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const idempotency = useRef<{ token: string; key: string } | undefined>(undefined)

  useEffect(() => {
    if (preview) previewHeading.current?.focus()
  }, [preview])

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
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    previewMutation.mutate(parsed.input)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || !online || remoteMissing) return
    const parsed = parseCorrection(draft, baseVersion)
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

  const cardAssets = assets.filter((asset) => asset.behavior === 'CREDIT_CARD')
  const originalCardMissing = !cardAssets.some((asset) => asset.assetId === draft.cardAssetId)
  const originalCategoryMissing = !categories.some((category) => category.categoryId === draft.categoryId)
  const pending = previewMutation.isPending || applyMutation.isPending
  return (
    <AppShell ledgerNavigation>
      <section className="mx-auto max-w-[52rem] py-5 md:py-8">
        <Button asChild variant="ghost"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}><ArrowLeft size={17} />카드 구매 상세</Link></Button>
        <header className="mt-4 border-b border-[var(--line)] pb-4">
          <h1 className="text-2xl font-semibold tracking-[-.025em]">카드 구매 기록 정정</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">입력한 구매 기록이 잘못되었을 때 사용합니다. 실제로 환불받았다면 환불 처리를 이용해 주세요.</p>
        </header>
        <CompactPurchaseLine purchase={purchase} />
        {dependenciesPending ? <LoadingLine label="정정에 필요한 자산과 분류를 불러오는 중…" /> : null}
        {dependenciesError ? <InlineError message="자산 또는 분류를 불러오지 못했어요." action="다시 불러오기" onAction={onRetryDependencies} /> : null}
        {remoteMissing ? <RemoteMissing returnTo={returnTo} /> : null}
        <ConflictPanel conflict={conflict} onRecalculate={recalculateLatest}>
          {conflict ? <CorrectionChanges purchase={conflict.latest.purchase} draft={draft} assets={assets} categories={categories} ledger={ledger} /> : null}
        </ConflictPanel>
        <form className="mt-5" onSubmit={submit} noValidate>
          {Object.values(errors).some(Boolean) ? <p ref={errorSummary} className="mb-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}
          <div className="grid gap-4 border-b border-[var(--line)] pb-5 md:grid-cols-[minmax(0,1.35fr)_minmax(13rem,.65fr)] md:gap-5">
            <MoneyField id="correctionAmount" label="금액" value={draft.amountWon} onValueChange={(value) => updateDraft('amountWon', value)} error={errors.amountWon} disabled={pending} required />
            <Field id="correctionDate" label="구매 날짜" type="date" value={draft.occurredOn} onChange={(event) => updateDraft('occurredOn', event.target.value)} error={errors.occurredOn} disabled={pending} required />
          </div>
          <div className="grid items-start gap-4 border-b border-[var(--line)] py-5 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(8rem,.55fr)] lg:gap-5">
            <SelectField id="correctionCategory" label="분류" value={draft.categoryId} onChange={(value) => updateDraft('categoryId', value)} error={errors.categoryId} disabled={pending}>
              {originalCategoryMissing && purchase.category ? <option value={purchase.category.categoryId}>{purchase.category.name} (현재 목록에 없음)</option> : null}
              {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
            </SelectField>
            <SelectField id="correctionCard" label="결제 카드" value={draft.cardAssetId} onChange={(value) => updateDraft('cardAssetId', value)} error={errors.cardAssetId} disabled={pending}>
              {originalCardMissing ? <option value={draft.cardAssetId}>{management.billingSnapshot.cardAssetName} (현재 목록에 없음)</option> : null}
              {cardAssets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}
            </SelectField>
            <Field id="correctionInstallments" label="할부 개월" hint="일시불은 1개월로 두세요." type="number" min={1} max={60} inputMode="numeric" value={draft.installmentCount} onChange={(event) => updateDraft('installmentCount', event.target.value)} error={errors.installmentCount} disabled={pending} required />
            <div className="md:col-span-2 lg:col-span-3"><PerformerPicker id="correctionPerformer" label={performerQuestionLabel('EXPENSE')} members={ledger.members} value={draft.performedByMemberId} onChange={(value) => updateDraft('performedByMemberId', value)} error={errors.performedByMemberId} disabled={pending} /></div>
          </div>
          <TextAreaField id="correctionDescription" label="내용 (선택)" value={draft.description} onChange={(value) => updateDraft('description', value)} error={errors.description} disabled={pending} />
          <StatisticsExclusionSwitch type="EXPENSE" checked={draft.excludedFromStatistics} onCheckedChange={(checked) => updateDraft('excludedFromStatistics', checked)} disabled={pending} />
          <OfflineNotice online={online} />
          <MutationError error={previewMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="변경 영향을 계산하지 못했어요." />
          <MutationError error={applyMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="정정을 적용하지 못했어요." />
          <div className="mt-5 flex flex-col-reverse gap-3 min-[22.5rem]:flex-row min-[22.5rem]:justify-end">
            {applyMutation.isPending ? <Button type="button" variant="secondary" size="large" disabled>취소</Button> : <Button asChild variant="secondary" size="large"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}>취소</Link></Button>}
            <Button type="button" size="large" onClick={() => requestPreview()} disabled={!online || pending || remoteMissing || Boolean(conflict) || dependenciesPending || dependenciesError}>{previewMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}변경 내용 확인</Button>
          </div>
          {preview ? (
            <ImpactPreview ref={previewHeading} title="변경 영향" preview={preview}>
              <CorrectionChanges purchase={purchase} draft={draft} assets={assets} categories={categories} ledger={ledger} />
              <Button type="submit" className="mt-5 w-full min-[22.5rem]:w-auto" size="large" disabled={!online || applyMutation.isPending}>
                {applyMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}정정 적용
              </Button>
            </ImpactPreview>
          ) : null}
        </form>
      </section>
    </AppShell>
  )
}

function RefundPage({ management, returnTo }: { management: CardPurchaseManagementView; returnTo: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const purchase = management.purchase
  const [draft, setDraft] = useState<RefundDraft>(() => ({ refundedOn: todayInSeoul(), amountWon: String(management.refundableAmountWon), description: '', excludedFromStatistics: purchase.excludedFromStatistics }))
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

  function requestPreview(expectedVersion = baseVersion) {
    const parsed = parseRefund(draft, expectedVersion, conflict?.latest.refundableAmountWon ?? management.refundableAmountWon)
    setErrors(parsed.errors)
    if (!parsed.input) {
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    previewMutation.mutate(parsed.input)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || !online || remoteMissing) return
    const parsed = parseRefund(draft, baseVersion, preview.refundableAmountWon)
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
      <section className="mx-auto max-w-[52rem] py-5 md:py-8">
        <Button asChild variant="ghost"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}><ArrowLeft size={17} />카드 구매 상세</Link></Button>
        <header className="mt-4 border-b border-[var(--line)] pb-4">
          <h1 className="text-2xl font-semibold tracking-[-.025em]">카드 구매 환불</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">판매처에서 실제로 환불받은 경우에만 기록합니다. 원 구매 기록은 남고 환불일의 지출에서 차감됩니다.</p>
        </header>
        <CompactPurchaseLine purchase={purchase} />
        <p className="mt-4 text-sm text-[var(--muted)]">현재 환불 가능 금액 <strong className="text-ink-900 dark:text-white">{formatWon(conflict?.latest.refundableAmountWon ?? management.refundableAmountWon)}</strong></p>
        {remoteMissing ? <RemoteMissing returnTo={returnTo} /> : null}
        <ConflictPanel conflict={conflict} onRecalculate={recalculateLatest}>
          {conflict ? <dl className="mt-3 grid gap-2 text-sm min-[30rem]:grid-cols-2"><Value label="최신 환불 가능 금액" value={formatWon(conflict.latest.refundableAmountWon)} /><Value label="내가 입력한 환불 금액" value={formatWon(parseWon(draft.amountWon) ?? 0)} /></dl> : null}
        </ConflictPanel>
        {management.refundableAmountWon <= 0 ? <NoRefundAvailable returnTo={returnTo} purchaseId={purchase.transactionId} /> : <form className="mt-5" onSubmit={submit} noValidate>
          {Object.values(errors).some(Boolean) ? <p ref={errorSummary} className="mb-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}
          <div className="grid gap-4 border-b border-[var(--line)] pb-5 md:grid-cols-[minmax(0,1.35fr)_minmax(13rem,.65fr)] md:gap-5">
            <MoneyField id="refundAmount" label="환불 금액" value={draft.amountWon} onValueChange={(value) => updateDraft('amountWon', value)} error={errors.amountWon} disabled={pending} required />
            <Field id="refundDate" label="환불일" type="date" value={draft.refundedOn} onChange={(event) => updateDraft('refundedOn', event.target.value)} error={errors.refundedOn} disabled={pending} required />
          </div>
          <TextAreaField id="refundDescription" label="내용 (선택)" value={draft.description} onChange={(value) => updateDraft('description', value)} error={errors.description} disabled={pending} />
          <StatisticsExclusionSwitch type="EXPENSE" checked={draft.excludedFromStatistics} onCheckedChange={(checked) => updateDraft('excludedFromStatistics', checked)} disabled={pending} />
          <OfflineNotice online={online} />
          <MutationError error={previewMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="환불 반영 내용을 계산하지 못했어요." />
          <MutationError error={applyMutation.error} hidden={Boolean(conflict || remoteMissing)} fallback="환불을 기록하지 못했어요." />
          <div className="mt-5 flex flex-col-reverse gap-3 min-[22.5rem]:flex-row min-[22.5rem]:justify-end">
            {applyMutation.isPending ? <Button type="button" variant="secondary" size="large" disabled>취소</Button> : <Button asChild variant="secondary" size="large"><Link to={`/transactions/${purchase.transactionId}/card-purchase`} state={{ returnTo }}>취소</Link></Button>}
            <Button type="button" size="large" onClick={() => requestPreview()} disabled={!online || pending || remoteMissing || Boolean(conflict) || (conflict?.latest.refundableAmountWon ?? management.refundableAmountWon) <= 0}>{previewMutation.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}환불 내용 확인</Button>
          </div>
          {preview ? (
            <ImpactPreview ref={previewHeading} title="환불 반영 내용" preview={preview}>
              <dl className="mt-4 grid gap-2 text-sm min-[30rem]:grid-cols-2">
                <Value label="환불일" value={draft.refundedOn} />
                <Value label="달력·통계" value={draft.excludedFromStatistics ? '집계 제외' : `지출에서 +${formatWon(parseWon(draft.amountWon) ?? 0)} 차감`} />
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
  return (
    <section className="border-b border-[var(--line)] py-5" aria-labelledby="purchase-summary-title">
      <h2 id="purchase-summary-title" className="sr-only">원 구매</h2>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <Value label="구매 날짜" value={purchase.occurredOn} />
        <Value label="구매 금액" value={formatWon(purchase.amountWon)} />
        <Value label="결제 카드" value={management.billingSnapshot.cardAssetName} />
        <Value label="분류" value={purchase.category?.name ?? '분류 없음'} />
        <Value label={performerPersonLabel('EXPENSE')} value={purchase.performedBy ? <span className="inline-flex items-center gap-1.5"><MemberAvatar displayName={purchase.performedBy.displayName} memberId={purchase.performedBy.memberId} size="xs" /><span>{purchase.performedBy.displayName}</span></span> : '구성원 없음'} />
        <Value label="결제 방식" value={management.billingSnapshot.installmentCount > 1 ? `${management.billingSnapshot.installmentCount}개월 할부` : '일시불'} />
        <Value label="달력·통계" value={purchase.excludedFromStatistics ? '집계 제외' : '지출에 포함'} />
        <Value className="sm:col-span-2" label="내용" value={purchase.description || '내용 없음'} />
      </dl>
    </section>
  )
}

function BillingDetails({ management }: { management: CardPurchaseManagementView }) {
  return (
    <section className="py-5" aria-labelledby="billing-details-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="billing-details-title" className="text-lg font-semibold">결제와 환불 내역</h2>
        <span className="text-sm text-[var(--muted)]">환불 가능 {formatWon(management.refundableAmountWon)}</span>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">매월 {management.billingSnapshot.statementClosingDay}일 정산 · {paymentMonthLabel(management.billingSnapshot.paymentMonthOffset)} {management.billingSnapshot.paymentDay}일 결제</p>
      {management.charges.length ? (
        <section className="mt-4" aria-labelledby="charge-schedule-title">
          <h3 id="charge-schedule-title" className="font-semibold">할부·청구 일정</h3>
          <ul className="mt-2 divide-y divide-[var(--line)] border-y border-[var(--line)] text-sm">
            {management.charges.map((charge) => <li className="grid gap-1 py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]" key={charge.chargeId}><span>{charge.installmentNo}/{charge.installmentCount}회 · {charge.expectedSettlementOn}</span><span className="font-semibold tabular-nums">환불 가능 {formatWon(charge.refundableAmountWon)}</span></li>)}
          </ul>
        </section>
      ) : null}
      <div className="mt-4 border-t border-[var(--line)]">
        {management.statements.length ? management.statements.map((statement) => (
          <section className="border-b border-[var(--line)] py-4" aria-labelledby={`statement-${statement.statementId}`} key={statement.statementId}>
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
            {statement.payments.length ? <ul className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)] text-sm">{statement.payments.map((payment) => <li className="grid gap-1 py-3 min-[30rem]:grid-cols-[1fr_auto]" key={payment.paymentId}><span>{payment.settlementAssetName} · {payment.paidOn}</span><span className="font-semibold tabular-nums">결제 {formatWon(payment.amountWon)}{payment.returnedAmountWon > 0 ? ` · 반환 ${formatWon(payment.returnedAmountWon)}` : ''}</span></li>)}</ul> : <p className="mt-3 text-sm text-[var(--muted)]">아직 결제 기록이 없어요.</p>}
          </section>
        )) : <p className="border-b border-[var(--line)] py-5 text-sm text-[var(--muted)]">연결된 카드 명세가 없어요.</p>}
      </div>
      {management.refunds.length ? (
        <section className="mt-6" aria-labelledby="refund-history-title">
          <h3 id="refund-history-title" className="font-semibold">환불 처리 내역</h3>
          <ul className="mt-2 divide-y divide-[var(--line)] border-y border-[var(--line)]">{management.refunds.map((refund) => <li className="py-3 text-sm" key={refund.refundId}><div className="flex flex-wrap justify-between gap-2"><span>{refund.refundedOn}{refund.excludedFromStatistics ? ' · 집계 제외' : ''}</span><strong>+{formatWon(refund.amountWon)}</strong></div><AccountReturns returns={refund.accountReturns} unpaidCardReductionWon={refund.unpaidCardReductionWon} /></li>)}</ul>
        </section>
      ) : null}
    </section>
  )
}

function CompactPurchaseLine({ purchase }: { purchase: Transaction }) {
  return <p className="border-b border-[var(--line)] py-4 text-sm leading-6"><span className="text-[var(--muted)]">원 구매 </span><strong>{purchase.occurredOn} · {formatWon(purchase.amountWon)}</strong><span className="text-[var(--muted)]"> · {purchase.description || purchase.category?.name || '카드 구매'}</span></p>
}

function ActionRow({ title, description, to, returnTo }: { title: string; description: string; to: string; returnTo: string }) {
  const descriptionId = `action-${title === '기록 정정' ? 'correction' : 'refund'}-description`
  return <div className="grid gap-3 border-t border-[var(--line)] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><h3 className="font-semibold">{title}</h3><p id={descriptionId} className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p></div><Button asChild variant="secondary"><Link to={to} state={{ returnTo }} aria-describedby={descriptionId}>{title}</Link></Button></div>
}

function UnavailableActionRow({ title, description }: { title: string; description: string }) {
  return <div className="border-t border-[var(--line)] py-5"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p></div>
}

function NoRefundAvailable({ returnTo, purchaseId }: { returnTo: string; purchaseId: string }) {
  return <section className="mt-5 border-y border-[var(--line)] py-6"><h2 className="font-semibold">환불할 수 있는 금액이 없어요</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">이 구매의 전체 금액이 이미 환불 처리됐어요. 원 구매와 기존 환불 내역은 상세에서 확인할 수 있어요.</p><Button asChild className="mt-4" variant="secondary"><Link to={`/transactions/${purchaseId}/card-purchase`} state={{ returnTo }}>카드 구매 상세</Link></Button></section>
}

const ImpactPreview = function ImpactPreview({ ref, title, preview, children }: { ref: Ref<HTMLHeadingElement>; title: string; preview: CardPurchaseCorrectionPreview | CardPurchaseRefundPreview; children: ReactNode }) {
  return (
    <section className="mt-6 border-y border-[var(--line)] py-5" aria-labelledby="card-purchase-impact-title">
      <h2 ref={ref} id="card-purchase-impact-title" className="text-lg font-semibold outline-none" tabIndex={-1}>{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">장부에서 카드와 실제 원 결제 계좌 내역을 함께 맞춥니다.</p>
      {children}
      <AccountReturns returns={preview.accountReturns} unpaidCardReductionWon={preview.unpaidCardReductionWon} />
    </section>
  )
}

function AccountReturns({ returns, unpaidCardReductionWon }: { returns: CardPurchaseAccountReturn[]; unpaidCardReductionWon: number }) {
  return (
    <dl className="mt-4 border-t border-[var(--line)] text-sm">
      <div className="grid gap-1 border-b border-[var(--line)] py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]"><dt>미결제 카드 금액 감소</dt><dd className="font-semibold tabular-nums">{formatWon(unpaidCardReductionWon)}</dd></div>
      {returns.map((accountReturn) => <div className="grid gap-1 border-b border-[var(--line)] py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]" key={`${accountReturn.assetId}-${accountReturn.amountWon}`}><dt>{accountReturn.assetName} 장부 반환</dt><dd className="font-semibold tabular-nums">{formatWon(accountReturn.amountWon)}</dd></div>)}
      {!returns.length ? <div className="border-b border-[var(--line)] py-3 text-[var(--muted)]">원 결제 계좌에 반환 기록할 금액이 없어요.</div> : null}
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
    ['분류', purchase.category?.name ?? '분류 없음', categoryName],
    ['결제 카드', purchase.asset?.name ?? '카드', cardName],
    [performerPersonLabel('EXPENSE'), purchase.performedBy?.displayName ?? '구성원 없음', performerName],
    ['할부', `${purchase.installmentCount ?? 1}개월`, `${draft.installmentCount}개월`],
    ['달력·통계', purchase.excludedFromStatistics ? '집계 제외' : '지출에 포함', draft.excludedFromStatistics ? '집계 제외' : '지출에 포함'],
    ['내용', purchase.description || '내용 없음', draft.description || '내용 없음'],
  ].filter(([, before, after]) => before !== after)
  return changes.length ? <dl className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)] text-sm">{changes.map(([label, before, after]) => <div className="grid gap-1 py-3 min-[30rem]:grid-cols-[7rem_minmax(0,1fr)_auto]" key={label}><dt className="font-semibold">{label}</dt><dd className="min-w-0 break-words text-[var(--muted)]">{before}</dd><dd className="min-w-0 break-words font-semibold min-[30rem]:text-right">→ {after}</dd></div>)}</dl> : <p className="mt-4 text-sm text-[var(--muted)]">입력한 값은 기존 구매 기록과 같아요.</p>
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

function TextAreaField({ id, label, value, onChange, error, disabled = false }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  return <TextareaField id={id} label={label} value={value} onChange={onChange} error={error} disabled={disabled} maxLength={500} className="grid gap-1 border-b border-[var(--line)] py-5" />
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
  if (Object.values(errors).some(Boolean) || !amountWon) return { errors }
  return { errors, input: { occurredOn: draft.occurredOn, amountWon, categoryId: draft.categoryId, cardAssetId: draft.cardAssetId, performedByMemberId: draft.performedByMemberId, installmentCount, expectedVersion, excludedFromStatistics: draft.excludedFromStatistics, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) } }
}

function parseRefund(draft: RefundDraft, expectedVersion: number, refundableAmountWon: number): { input?: CardPurchaseRefundInput; errors: FieldErrors<RefundDraft> } {
  const errors: FieldErrors<RefundDraft> = {}
  const amountWon = parseWon(draft.amountWon)
  if (!amountWon) errors.amountWon = '0원보다 큰 원 단위 정수를 입력해 주세요.'
  else if (amountWon > refundableAmountWon) errors.amountWon = `현재 환불 가능 금액 ${formatWon(refundableAmountWon)} 이하로 입력해 주세요.`
  if (!draft.refundedOn) errors.refundedOn = '환불일을 선택해 주세요.'
  if (Object.values(errors).some(Boolean) || !amountWon) return { errors }
  return { errors, input: { refundedOn: draft.refundedOn, amountWon, expectedVersion, excludedFromStatistics: draft.excludedFromStatistics, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) } }
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
