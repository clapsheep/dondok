import { StepIndicator } from '../../components/ui/StepIndicator'
import { TransactionDetail } from './TransactionDetailPage'
import { suggestedTransferPurpose, transferPurposeLabels, type TransferPurpose } from './transferPurpose'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ChevronDown, Check, Copy, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams, type BlockerFunction } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { DatePickerField } from '../../components/ui/DatePickerField'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { MoneyField } from '../../components/ui/MoneyField'
import { Switch } from '../../components/ui/Switch'
import './record-layout.css'
import { ApiError } from '../../lib/api'
import { hasFieldErrors } from '../../lib/formErrors'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetApi, assetKeys, type Asset } from '../assets/api'
import { AssetPicker } from '../assets/AssetPicker'
import { cardStatementKeys } from '../card-statements/api'
import { categoryApi, categoryKeys, type Category } from '../categories/api'
import type { LedgerBook } from '../membership/api'
import {
  transactionApi,
  transactionKeys,
  type CreateTransactionInput,
  type Transaction,
  type TransactionType,
  type UpdateTransactionInput,
} from './api'
import { performerPersonLabel, performerQuestionLabel, performerSelectionError } from './performerLabels'
import { transferAssetLabel, transferEligibleAssets } from './transferAssets'
import { CategoryPicker } from './CategoryPicker'
import { readLastExpenseAssetId, rememberLastExpenseAsset } from './lastExpenseAsset'
import { readLastTransactionDate, rememberLastTransactionDate } from './lastTransactionDate'
import { PerformerPicker } from './PerformerPicker'

type Draft = {
  type: TransactionType
  amountWon: string
  occurredOn: string
  categoryId: string
  assetId: string
  sourceAssetId: string
  destinationAssetId: string
  transferPurpose: TransferPurpose | null
  performedByMemberId: string
  description: string
  installmentCount: string
  excludedFromStatistics: boolean
  representativePayment: boolean
  statisticsAmountWon: string
}

type FieldErrors = Partial<Record<keyof Draft, string>>
type Conflict = { latest: Transaction; action: 'update' | 'delete' }
type NavigationState = { returnTo?: string; transactionDraft?: Draft; transactionDate?: string }

export function TransactionFormPage({ ledger }: { ledger: LedgerBook }) {
  const { transactionId } = useParams()
  const location = useLocation()
  const assets = useQuery({
    queryKey: assetKeys.list,
    queryFn: assetApi.list,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const transaction = useQuery({
    queryKey: transactionKeys.detail(transactionId ?? ''),
    queryFn: () => transactionApi.detail(transactionId!),
    enabled: Boolean(transactionId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })

  if (transactionId && transaction.isPending) return <AppShell ledgerNavigation><LoadingState /></AppShell>
  if (transactionId && transaction.isError && !transaction.data) {
    if (transaction.error instanceof ApiError && transaction.error.status === 404) return <MissingTransaction returnTo={safeReturnTo(location.state)} />
    return <AppShell ledgerNavigation><LoadError message="거래를 불러오지 못했어요." onRetry={() => transaction.refetch()} /></AppShell>
  }
  if (transaction.data?.managementType === 'CARD_PURCHASE') return <Navigate to={`/transactions/${transaction.data.transactionId}/card-purchase`} replace state={location.state} />
  if (transaction.data?.managementType === 'CARD_REFUND' && transaction.data.relatedPurchaseTransactionId) return <Navigate to={`/transactions/${transaction.data.relatedPurchaseTransactionId}/card-purchase`} replace state={location.state} />
  if (transaction.data?.managementType === 'SYSTEM' && transaction.data.cardPayment) return <TransactionDetail transaction={transaction.data} returnTo={safeReturnTo(location.state, transaction.data.occurredOn)} editing />
  if (transaction.data && transaction.data.managementType !== 'GENERAL') return <ManagedTransaction transaction={transaction.data} returnTo={safeReturnTo(location.state)} />
  if (assets.isPending) return <AppShell ledgerNavigation><LoadingState /></AppShell>
  if (assets.isError && !assets.data) return <AppShell ledgerNavigation><LoadError message="거래에 사용할 자산을 불러오지 못했어요." onRetry={() => assets.refetch()} /></AppShell>
  if (!assets.data?.length) return <AppShell ledgerNavigation><NoAssets /></AppShell>

  const state = location.state as NavigationState | null
  const currentMemberId = ledger.members.find((member) => member.currentUser)?.memberId ?? ledger.members[0]?.memberId ?? ''
  const lastExpenseAssetId = !transactionId && !state?.transactionDraft
    ? readLastExpenseAssetId(window.localStorage, {
        ledgerId: ledger.ledgerId,
        memberId: currentMemberId,
        activeAssetIds: assets.data.map((asset) => asset.assetId),
      })
    : ''
  const requestedAssetId = new URLSearchParams(location.search).get('assetId')
  const entryAssetId = !transactionId && assets.data.some(asset => asset.assetId === requestedAssetId) ? requestedAssetId! : undefined
  return (
    <TransactionEditor
      key={transactionId ?? 'new-transaction'}
      ledger={ledger}
      assets={assets.data}
      transaction={transaction.data}
      initialDraft={!transactionId ? state?.transactionDraft : undefined}
      initialDate={!transactionId ? state?.transactionDate : undefined}
      initialAssetId={entryAssetId ?? lastExpenseAssetId}
      initialSourceAssetId={entryAssetId}
      returnAfterCreate={entryAssetId ? safeReturnTo(state, undefined, `/assets/${entryAssetId}`) : undefined}
      returnTo={safeReturnTo(location.state, transaction.data?.occurredOn)}
    />
  )
}

function TransactionEditor({ ledger, assets, transaction, initialDraft, initialDate, initialAssetId, initialSourceAssetId, returnTo, returnAfterCreate }: { ledger: LedgerBook; assets: Asset[]; transaction?: Transaction; initialDraft?: Draft; initialDate?: string; initialAssetId?: string; initialSourceAssetId?: string; returnTo: string; returnAfterCreate?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const editing = Boolean(transaction)
  const [step, setStep] = useState(1)
  const stepTitle = useRef<HTMLHeadingElement>(null)
  function goToStep(next: number) {
    setStep(next)
    requestAnimationFrame(() => { if (stepTitle.current?.getClientRects().length) stepTitle.current.focus() })
  }
  const currentMemberId = ledger.members.find((member) => member.currentUser)?.memberId ?? ledger.members[0]?.memberId ?? ''
  const [defaultDate] = useState(() => transaction || initialDraft ? undefined : initialDate ?? readLastTransactionDate({
    ledgerId: ledger.ledgerId,
    memberId: ledger.members.find((member) => member.currentUser)?.memberId ?? '',
  }))
  const [pristineDraft, setPristineDraft] = useState<Draft>(() => transaction
    ? draftFromTransaction(transaction)
    : validNavigationDraft(undefined, currentMemberId, defaultDate, initialAssetId, initialSourceAssetId))
  const [draft, setDraft] = useState<Draft>(() => transaction ? draftFromTransaction(transaction) : validNavigationDraft(initialDraft, currentMemberId, defaultDate, initialAssetId, initialSourceAssetId))
  const allowNavigation = useRef(false)
  const [baseVersion, setBaseVersion] = useState(transaction?.version ?? 0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [conflict, setConflict] = useState<Conflict>()
  const [remoteDeleted, setRemoteDeleted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const errorSummary = useRef<HTMLParagraphElement>(null)
  const idempotency = useRef<{ fingerprint: string; key: string } | undefined>(undefined)
  const categoryKind = draft.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
  const categories = useQuery({
    queryKey: categoryKeys.list(categoryKind),
    queryFn: () => categoryApi.list(categoryKind),
    enabled: draft.type !== 'TRANSFER',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const transferAssets = transferEligibleAssets(assets)
  const assetId = editing ? draft.assetId : draft.assetId || assets[0]?.assetId || ''
  const sourceAssetId = transferSelection(draft.sourceAssetId, transferAssets)
    || (!draft.sourceAssetId && !editing ? transferAssets[0]?.assetId ?? '' : '')
  const sourceOwner = transferAssets.find((asset) => asset.assetId === sourceAssetId)?.ownerMemberId
  const destinationAssets = transferAssets.filter((asset) => asset.ownerMemberId === sourceOwner && asset.assetId !== sourceAssetId)
  const destinationAssetId = transferSelection(draft.destinationAssetId, destinationAssets)
    || (!draft.destinationAssetId && !editing
      ? destinationAssets[0]?.assetId ?? ''
      : '')
  const transferPurpose = draft.transferPurpose ?? suggestedTransferPurpose(
    assets.find((asset) => asset.assetId === sourceAssetId)?.systemCode,
    assets.find((asset) => asset.assetId === destinationAssetId)?.systemCode,
  )
  const categoryId = editing ? draft.categoryId : draft.categoryId || categories.data?.[0]?.categoryId || ''
  const selectedAsset = assets.find((asset) => asset.assetId === assetId)
  const isCardExpense = draft.type === 'EXPENSE' && selectedAsset?.behavior === 'CREDIT_CARD'
  const unavailableTransferSelection = draft.type === 'TRANSFER'
    && ((!sourceAssetId && Boolean(draft.sourceAssetId))
      || (!destinationAssetId && Boolean(draft.destinationAssetId)))
  const hasUnsavedChanges = !sameDraft(draft, pristineDraft)
  const blocker = useBlocker(useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (allowNavigation.current || !hasUnsavedChanges) return false
    return currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  }, [hasUnsavedChanges]))
  useBeforeUnload(useCallback((event) => {
    if (allowNavigation.current || !hasUnsavedChanges) return
    event.preventDefault()
    event.returnValue = ''
  }, [hasUnsavedChanges]))

  const create = useMutation({
    mutationFn: ({ input, key }: { input: CreateTransactionInput; key: string }) => transactionApi.create(input, key),
    onSuccess: (created) => finishMutation(created, 'transactionSaved'),
  })
  const updateTransaction = useMutation({
    mutationFn: (input: UpdateTransactionInput) => transactionApi.update(transaction!.transactionId, input),
    onSuccess: (updated) => finishMutation(updated, 'transactionUpdated'),
    onError: (error) => void handleMutationError(error, 'update'),
  })
  const remove = useMutation({
    mutationFn: (expectedVersion: number) => transactionApi.remove(transaction!.transactionId, expectedVersion),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: transactionKeys.detail(transaction!.transactionId) })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      void queryClient.invalidateQueries({ queryKey: assetKeys.all })
      allowNavigation.current = true
      navigate(returnTo, { replace: true, state: { transactionDeleted: true } })
    },
    onError: (error) => void handleMutationError(error, 'delete'),
  })

  async function finishMutation(saved: Transaction, status: 'transactionSaved' | 'transactionUpdated') {
    if (status === 'transactionSaved') {
      rememberLastTransactionDate({
        ledgerId: ledger.ledgerId,
        memberId: ledger.members.find((member) => member.currentUser)?.memberId ?? '',
      }, saved.occurredOn)
    }
    // 이 화면에서 활성화된 상세 query가 먼저 재조회되면 일반 거래를 카드 구매로
    // 바꾼 직후 전용 상세 redirect가 목록 복귀보다 앞설 수 있다. 이동할 화면에서
    // 최신 데이터를 읽도록 stale 처리만 하고 현재 route에서는 refetch하지 않는다.
    // 일반 거래는 서버 성공 응답을 상세 cache에도 반영해 다시 편집할 때 이전
    // version으로 초안이 초기화되어 412 충돌이 나는 것을 막는다. 카드 구매 응답은
    // 현재 route의 전용 상세 redirect를 유발할 수 있으므로 cache에 쓰지 않는다.
    if (saved.managementType === 'GENERAL') {
      queryClient.setQueryData(transactionKeys.detail(saved.transactionId), saved)
    }
    if (saved.type === 'EXPENSE' && saved.asset?.assetId && saved.performedBy?.memberId === currentMemberId) {
      rememberLastExpenseAsset(window.localStorage, {
        ledgerId: ledger.ledgerId,
        memberId: currentMemberId,
        assetId: saved.asset.assetId,
      })
    }
    const refetchType = 'none' as const
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: transactionKeys.all, refetchType }),
      queryClient.invalidateQueries({ queryKey: assetKeys.all, refetchType }),
      queryClient.invalidateQueries({ queryKey: cardStatementKeys.all, refetchType }),
    ]
    void Promise.all(invalidations)
    const fallback = `/?view=daily&month=${saved.occurredOn.slice(0, 7)}`
    allowNavigation.current = true
    navigate(editing ? returnTo : returnAfterCreate ?? fallback, { replace: true, state: { [status]: true } })
  }

  async function handleMutationError(error: unknown, action: Conflict['action']) {
    if (!(error instanceof ApiError) || !transaction) return
    setErrors(apiFieldErrors(error))
    if (error.status === 404) {
      setRemoteDeleted(true)
      setConflict(undefined)
      setConfirmDelete(false)
      return
    }
    if (error.status !== 412) return
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transaction.transactionId),
        queryFn: () => transactionApi.detail(transaction.transactionId),
        staleTime: 0,
      })
      setConflict({ latest, action })
      setConfirmDelete(false)
    } catch (latestError) {
      if (latestError instanceof ApiError && latestError.status === 404) setRemoteDeleted(true)
    }
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    if ((key === 'amountWon' || key === 'statisticsAmountWon') && String(value).replace(/\D/g, '').length > 10) {
      setErrors(current => ({ ...current, [key]: '금액은 최대 10자리까지 입력해 주세요.' })); return
    }
    if (key === 'description' && String(value).length > 40 && String(value).length >= draft.description.length) return
    setErrors((current) => ({ ...current, [key]: undefined }))
    setDraft((current) => ({ ...current, [key]: value }))
    create.reset()
    updateTransaction.reset()
  }

  function selectType(type: TransactionType) {
    if (editing) return
    setErrors({})
    setDraft((current) => ({ ...current, type, categoryId: '' }))
    create.reset()
  }

  function nextStep() {
    const parsed = parseDraft({ ...draft, assetId, sourceAssetId, destinationAssetId, categoryId, transferPurpose }, isCardExpense)
    const keys: (keyof Draft)[] = step === 1 ? ['occurredOn'] : ['categoryId', 'assetId', 'sourceAssetId', 'destinationAssetId']
    const currentErrors = Object.fromEntries(keys.filter(key => parsed.errors[key]).map(key => [key, parsed.errors[key]]))
    setErrors(currentErrors)
    if (Object.keys(currentErrors).length) return
    if (step === 2 && draft.type !== 'TRANSFER' && (categories.isPending || categories.isError)) return
    goToStep(Math.min(step + 1, 3))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || remoteDeleted) return
    const parsed = parseDraft({ ...draft, assetId, sourceAssetId, destinationAssetId, categoryId, transferPurpose }, isCardExpense)
    setErrors(parsed.errors)
    if (!parsed.input) {
      goToStep(parsed.errors.occurredOn ? 1 : parsed.errors.categoryId || parsed.errors.assetId || parsed.errors.sourceAssetId || parsed.errors.destinationAssetId ? 2 : 3)
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    if (editing) {
      updateTransaction.mutate(toUpdateInput(parsed.input, baseVersion))
      return
    }
    const fingerprint = JSON.stringify(parsed.input)
    if (!idempotency.current || idempotency.current.fingerprint !== fingerprint) idempotency.current = { fingerprint, key: crypto.randomUUID() }
    create.mutate({ input: parsed.input, key: idempotency.current.key })
  }

  function useLatestVersion() {
    if (!conflict) return
    setBaseVersion(conflict.latest.version)
    setConflict(undefined)
    setErrors({})
    updateTransaction.reset()
    remove.reset()
  }

  function restoreLatest() {
    if (!conflict) return
    const latestDraft = draftFromTransaction(conflict.latest)
    setPristineDraft(latestDraft)
    setDraft(latestDraft)
    setBaseVersion(conflict.latest.version)
    setConflict(undefined)
    setErrors({})
    updateTransaction.reset()
    remove.reset()
  }

  function convertToNew() {
    allowNavigation.current = true
    navigate('/transactions/new', { replace: true, state: { transactionDraft: draft, returnTo } satisfies NavigationState })
  }

  function keepEditing() {
    if (blocker.state === 'blocked') blocker.reset()
  }

  function leaveEditor() {
    if (blocker.state === 'blocked') blocker.proceed()
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(copyableDraft(resolvedDraft, assets, categories.data ?? [], ledger))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const pending = create.isPending || updateTransaction.isPending
  const mutationError = editing ? updateTransaction.error : create.error
  const resolvedDraft = { ...draft, assetId, sourceAssetId, destinationAssetId, categoryId, transferPurpose }

  const editor = (
    <>
      <section className="transaction-record" data-record-step={step}>
        {!editing && returnAfterCreate ? <Button asChild variant="ghost" className="mb-3"><Link to={returnAfterCreate}><ArrowLeft size={17} />자산으로 돌아가기</Link></Button> : null}
        <header className="tr-desktop-title"><h1 className="text-2xl font-semibold">{editing ? '거래 수정' : '기록'}</h1><p className="mt-2 text-sm text-[var(--muted)]">한 번의 거래, 간단하게 남겨요.</p></header>
        <div className="tr-mobile-progress"><Button type="button" variant="ghost" size="icon" aria-label="이전 단계" disabled={step===1} onClick={()=>goToStep(step-1)}><ArrowLeft size={19}/></Button><span>{editing ? '거래 수정' : '기록'}</span><StepIndicator step={step} label="기록 진행"/></div>
        <h1 ref={stepTitle} tabIndex={-1} className="tr-mobile-title">{step===1 ? '어떤 거래인가요?' : step===2 ? draft.type==='TRANSFER' ? '어디로 옮겼나요?' : '분류와 자산을 확인해요' : draft.type==='INCOME' ? '얼마를 받았나요?' : draft.type==='TRANSFER' ? '얼마를 옮겼나요?' : '얼마를 썼나요?'}</h1>
        <div className="tr-mobile-crumbs">{step>1 ? <Button variant="ghost" type="button" onClick={()=>goToStep(1)}>{typeLabel(draft.type)} · {draft.occurredOn.slice(5).replace('-', '.')}<ChevronDown size={14}/></Button> : null}{step>2 ? <Button variant="ghost" type="button" onClick={()=>goToStep(2)}>{draft.type==='TRANSFER' ? transferPurposeLabels[transferPurpose] : `${categories.data?.find(item=>item.categoryId===categoryId)?.name ?? '분류'} · ${selectedAsset?.name ?? '자산'}`}<ChevronDown size={14}/></Button> : null}</div>

        {remoteDeleted ? (
          <section className="mt-5 border-l-4 border-amber-500 px-4 py-2" aria-labelledby="deleted-transaction-title">
            <h2 id="deleted-transaction-title" className="font-semibold">다른 구성원이 이 거래를 먼저 삭제했어요</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">작성 중인 내용은 그대로 두었어요. 새 거래로 전환하거나 내용을 복사할 수 있습니다.</p>
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={convertToNew}>새 거래로 전환</Button><Button type="button" variant="secondary" onClick={copyDraft}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '복사됨' : '입력 복사'}</Button><Button asChild type="button" variant="ghost"><Link to={returnTo}>목록으로 돌아가기</Link></Button></div>
          </section>
        ) : null}

        {conflict ? (
          <section className="mt-5 border-l-4 border-amber-500 px-4 py-2" aria-labelledby="transaction-conflict-title">
            <h2 id="transaction-conflict-title" className="font-semibold">다른 구성원이 먼저 거래를 변경했어요</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">자동으로 합치지 않았습니다. 최신값과 내 입력을 확인한 뒤 선택해 주세요.</p>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><TransactionSummary title="최신값" draft={draftFromTransaction(conflict.latest)} assets={assets} categories={categories.data ?? []} ledger={ledger} /><TransactionSummary title="내 입력" draft={draft} assets={assets} categories={categories.data ?? []} ledger={ledger} /></div>
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={useLatestVersion}><Check size={17} />최신 버전에 {conflict.action === 'delete' ? '삭제 적용' : '내 입력 적용'}</Button><Button type="button" variant="secondary" onClick={restoreLatest}><RotateCcw size={17} />최신값으로 되돌리기</Button></div>
          </section>
        ) : null}

        <form className="tr-form" onSubmit={submit} noValidate>
          {hasFieldErrors(errors) ? <p ref={errorSummary} className="my-4 text-sm text-[var(--expense)] outline-none" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}
          <section className="tr-panel" data-record-panel="1" onFocusCapture={()=>setStep(1)} aria-label="거래 종류와 날짜">
            <fieldset><legend className="mb-2 text-[13px] font-medium">거래 종류</legend>
              {editing ? <p className="tr-fixed-type">{typeLabel(draft.type)} · 종류는 바꿀 수 없어요</p> : <div className="tr-type-tabs"><TypeButton type="EXPENSE" selected={draft.type} onSelect={selectType}>지출</TypeButton><TypeButton type="INCOME" selected={draft.type} onSelect={selectType}>수입</TypeButton><TypeButton type="TRANSFER" selected={draft.type} onSelect={selectType}>이체</TypeButton></div>}
            </fieldset>
            <DatePickerField id="transactionDate" label="날짜" value={draft.occurredOn} onChange={value => updateDraft('occurredOn', value)} error={errors.occurredOn} required />
          </section>
          <section className="tr-panel" data-record-panel="2" onFocusCapture={()=>setStep(2)} aria-label="분류와 자산">
            {draft.type === 'TRANSFER' ? (
              <div className="grid gap-4 pt-1 ">
                {destinationAssets.length === 0 ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3] " role="status">이체하려면 같은 명의의 계좌·적금·주식 계좌가 두 개 이상 필요해요.</p> : null}
                {unavailableTransferSelection ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3] " role="status">이 이체에 연결된 자산은 현재 일반 이체에 사용할 수 없어요. 보내는 자산과 받는 자산을 다시 선택해 주세요.</p> : null}
                <AssetPicker id="sourceAsset" label="보내는 자산" assets={transferAssets} members={ledger.members} value={sourceAssetId} onChange={(value) => { updateDraft('sourceAssetId', value); updateDraft('destinationAssetId', '') }} error={errors.sourceAssetId} placeholder="계좌·적금·주식 계좌를 선택해 주세요" required />

                <p className="text-xs leading-5 text-[var(--muted)] ">이체는 같은 명의 자산 사이에서 기록해요. 사람 간 송금은 각자의 수입·지출로 입력해 주세요.</p>
                <AssetPicker id="destinationAsset" label="받는 자산" assets={destinationAssets} members={ledger.members} value={destinationAssetId} onChange={(value) => updateDraft('destinationAssetId', value)} error={errors.destinationAssetId} placeholder="계좌·적금·주식 계좌를 선택해 주세요" required />
                <fieldset className="">
                  <legend className="text-sm font-semibold">이체 목적</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(transferPurposeLabels).map(([purpose, label]) => <Button key={purpose} type="button" variant={transferPurpose === purpose ? 'primary' : 'secondary'} aria-pressed={transferPurpose === purpose} onClick={() => updateDraft('transferPurpose', purpose as TransferPurpose)}>{label}</Button>)}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">납입은 적금·투자 통계와 총 사용액에, 인출은 회수액에 반영돼요. 모아둔 돈을 다시 옮길 때는 일반 이체를 선택하세요.</p>
                </fieldset>
              </div>
) : <>
              {categories.isError ? <div role="alert" className="text-sm text-[var(--expense)]">분류를 불러오지 못했어요.<Button type="button" variant="ghost" onClick={() => categories.refetch()}>분류 다시 불러오기</Button></div> : null}
              <CategoryPicker key={categoryKind} kind={categoryKind} categories={categories.data ?? []} value={categoryId} missingName={transaction?.category?.name} onChange={value => updateDraft('categoryId', value)} error={errors.categoryId} disabled={categories.isPending || categories.isError || pending || remoteDeleted} online={online} />
              <AssetPicker id="transactionAsset" label={draft.type === 'INCOME' ? '입금 자산' : '결제 자산'} assets={assets} members={ledger.members} value={assetId} onChange={value => updateDraft('assetId', value)} missingSelection={transaction?.asset && !assets.some(asset => asset.assetId === transaction.asset?.assetId) ? { assetId: transaction.asset.assetId, name: transaction.asset.name } : undefined} error={errors.assetId} required />
            </>}
          </section>
          <section className="tr-panel" data-record-panel="3" onFocusCapture={()=>setStep(3)} aria-label="금액과 내용">
            <div>
              <MoneyField id="transactionAmount" label="금액" value={draft.amountWon} onValueChange={value => updateDraft('amountWon', value)} placeholder="0" error={errors.amountWon} inputClassName="tr-amount" maxLength={13} required />
              <div className="tr-inline-options">
                {draft.type === 'EXPENSE' ? <label><Switch checked={draft.representativePayment} onCheckedChange={value => updateDraft('representativePayment', value)} aria-label="대표로 결제했어요" disabled={pending || remoteDeleted}/><span aria-hidden="true">대표 결제</span></label> : null}
                {draft.type !== 'TRANSFER' ? <label><Switch checked={draft.excludedFromStatistics} onCheckedChange={value => updateDraft('excludedFromStatistics', value)} aria-label={`${draft.type === 'INCOME' ? '수입' : '지출'}에 포함하지 않기`} disabled={pending || remoteDeleted}/><span aria-hidden="true">{draft.type === 'INCOME' ? '수입' : '지출'}에 포함하지 않기</span></label> : null}
              </div>
              {draft.type === 'EXPENSE' && draft.representativePayment ? <div className="tr-representative"><MoneyField id="statisticsAmountWon" inputClassName="tr-amount" label="지출로 반영할 금액" value={draft.statisticsAmountWon} onValueChange={value => updateDraft('statisticsAmountWon', value)} maxLength={13} placeholder="0" error={errors.statisticsAmountWon} disabled={pending || remoteDeleted} required hint="0원부터 실제 결제 금액까지 입력할 수 있어요."/><p className="mt-3 text-[13px] leading-6 text-[var(--muted)]">실제 결제 {formatWon(Number(draft.amountWon) || 0)} · {draft.excludedFromStatistics ? '달력·통계에는 반영하지 않아요.' : `내 지출 ${formatWon(Number(draft.statisticsAmountWon) || 0)}`}</p></div> : null}
              {draft.type !== 'TRANSFER' && draft.excludedFromStatistics && !draft.representativePayment ? <p className="text-[13px] text-[var(--muted)]">자산 잔액은 바뀌지만 달력과 통계 합계에는 반영하지 않아요.</p> : null}
              {isCardExpense ? <details className="tr-installment" open={errors.installmentCount ? true : undefined}><summary>카드 결제 · {draft.installmentCount === '1' ? '일시불' : `${draft.installmentCount}개월 할부`} <ChevronDown size={14}/></summary><Field id="installmentCount" label="할부 개월" hint="일시불은 1개월로 두세요." type="number" min={1} max={60} value={draft.installmentCount} onChange={event => updateDraft('installmentCount', event.target.value)} inputMode="numeric" error={errors.installmentCount} required /></details> : null}
            </div>
            <div className="relative"><Field id="transactionDescription" label="내용 (선택)" value={draft.description} onChange={event => updateDraft('description', event.target.value)} maxLength={40} placeholder="어디에 썼는지 짧게 남겨요"/><span className="absolute right-0 top-0 text-[13px] tabular-nums text-[var(--muted)]">{draft.description.length}/40</span>{draft.description.length > 40 ? <p className="text-xs text-[var(--muted)]">기존 내용은 보존했어요. 변경할 때는 40자 이내로 입력해 주세요.</p> : null}</div>
          </section>
          {!online ? <p className="my-4 text-sm text-[var(--muted)]" role="status">인터넷 연결을 확인해 주세요. 입력은 그대로 두었고 연결되면 저장할 수 있어요.</p> : null}
          {mutationError && !(mutationError instanceof ApiError && [404, 412].includes(mutationError.status)) ? <p className="my-4 text-sm text-[var(--expense)]" role="alert">{mutationError instanceof Error ? mutationError.message : '거래를 저장하지 못했어요.'} 입력은 그대로 두었습니다.</p> : null}
          <footer className="tr-footer">
            <details className="tr-performer" open={errors.performedByMemberId ? true : undefined}><summary><MemberAvatar memberId={draft.performedByMemberId} displayName={ledger.members.find(member => member.memberId === draft.performedByMemberId)?.displayName ?? '구성원'} size="xs"/><span>{performerPersonLabel(draft.type)} · {draft.performedByMemberId === currentMemberId ? '나' : ledger.members.find(member => member.memberId === draft.performedByMemberId)?.displayName ?? '구성원'}</span><ChevronDown size={14}/></summary><PerformerPicker id="performedBy" label={performerQuestionLabel(draft.type)} members={ledger.members} value={draft.performedByMemberId} onChange={value => updateDraft('performedByMemberId', value)} error={errors.performedByMemberId} disabled={pending || remoteDeleted}/></details>
            <Button className="tr-next" type="button" onClick={nextStep}>다음<ArrowRight size={17}/></Button>
            <Button className="tr-save" type="submit" size="large" disabled={pending || !online || remoteDeleted || (draft.type !== 'TRANSFER' && (categories.isPending || categories.isError)) || (draft.type === 'TRANSFER' && (destinationAssets.length === 0 || !sourceAssetId || !destinationAssetId))}>{pending ? <LoaderCircle className="animate-spin" size={18}/> : null}{editing ? '변경 저장' : '기록 저장'}</Button>
          </footer>
        </form>

        {editing ? (
          <section className="mt-10 border-t border-[var(--line)] pt-6" aria-labelledby="delete-transaction-title">
            <h2 id="delete-transaction-title" className="text-lg font-semibold">거래 삭제</h2>
            {!confirmDelete ? <Button className="mt-3" type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={remoteDeleted}><Trash2 size={17} />기록 삭제</Button> : <div className="mt-3 border-y border-[var(--line)] py-4"><p className="font-semibold">이 거래를 삭제할까요?</p><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{draft.type === 'TRANSFER' ? '두 자산의 잔액을 함께 되돌립니다.' : '자산 잔액을 되돌리고 해당 월의 수입·지출 통계에서 제외합니다.'}</p>{remove.error && !(remove.error instanceof ApiError && [404, 412].includes(remove.error.status)) ? <p className="mt-3 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{remove.error.message}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={!online || remove.isPending || remoteDeleted} onClick={() => remove.mutate(baseVersion)}>{remove.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}거래 삭제</Button><Button type="button" variant="secondary" onClick={() => { setConfirmDelete(false); remove.reset() }}>취소</Button></div></div>}
          </section>
        ) : null}
      </section>
      <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) keepEditing() }}>
        <DialogContent className="p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>작성 중인 기록을 나갈까요?</DialogTitle>
            <DialogDescription>입력한 내용은 저장되지 않고 모두 사라져요.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={keepEditing}>계속 작성</Button>
            <Button type="button" variant="destructive" onClick={leaveEditor}>나가기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return <AppShell ledgerNavigation mobileHeader={editing ? { title: '거래 수정', backTo: returnTo, backLabel: '거래 목록으로' } : undefined}>{editor}</AppShell>
}

function ManagedTransaction({ transaction, returnTo }: { transaction: Transaction; returnTo: string }) {
  return <AppShell ledgerNavigation><section className="mx-auto max-w-[40rem] py-5 md:py-8"><Button asChild variant="ghost"><Link to={returnTo}><ArrowLeft size={17} />가계부로 돌아가기</Link></Button><header className="mt-4 border-b border-[var(--line)] pb-4"><h1 className="text-2xl font-semibold">{transaction.managementType === 'CARD_PURCHASE' ? '카드 구매' : '자동 기록'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{transaction.managementType === 'CARD_PURCHASE' ? '카드 구매는 카드 결제 흐름과 함께 관리되어 일반 거래 화면에서 수정하거나 삭제할 수 없어요.' : '자동으로 생성된 기록은 일반 거래 화면에서 수정하거나 삭제할 수 없어요.'}</p></header><dl className="grid gap-3 border-b border-[var(--line)] py-5 text-sm sm:grid-cols-2"><div><dt className="text-[var(--muted)]">날짜</dt><dd className="mt-1 font-semibold">{transaction.occurredOn}</dd></div><div><dt className="text-[var(--muted)]">금액</dt><dd className="mt-1 font-semibold">{formatWon(transaction.amountWon)}</dd></div><div><dt className="text-[var(--muted)]">내용</dt><dd className="mt-1 font-semibold">{transaction.description || transaction.category?.name || typeLabel(transaction.type)}</dd></div><div><dt className="text-[var(--muted)]">{performerPersonLabel(transaction.type)}</dt><dd className="mt-1 font-semibold"><MemberValue member={transaction.performedBy} fallback="자동 기록" /></dd></div></dl></section></AppShell>
}

function MissingTransaction({ returnTo }: { returnTo: string }) { return <AppShell ledgerNavigation><section className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">거래를 찾을 수 없어요</h1><p className="mt-2 text-sm text-[var(--muted)]">다른 구성원이 이미 삭제했거나 주소가 올바르지 않을 수 있어요.</p><Button asChild className="mt-5"><Link to={returnTo}>가계부로 돌아가기</Link></Button></section></AppShell> }

function TransactionSummary({ title, draft, assets, categories, ledger }: { title: string; draft: Draft; assets: Asset[]; categories: Category[]; ledger: LedgerBook }) {
  const assetName = (id: string) => draft.type === 'TRANSFER'
    ? transferAssetName(id, assets, ledger, '현재 목록에 없음')
    : assets.find((asset) => asset.assetId === id)?.name ?? '현재 목록에 없음'
  const categoryName = categories.find((category) => category.categoryId === draft.categoryId)?.name ?? '현재 목록에 없음'
  const member = ledger.members.find((item) => item.memberId === draft.performedByMemberId)
  return <dl className="border-y border-[var(--line)] py-2"><dt className="font-semibold">{title}</dt><dd className="mt-1 text-[var(--muted)]">{draft.occurredOn} · {formatWon(Number(draft.amountWon) || 0)}</dd><dd className="mt-1 text-[var(--muted)]">{draft.type === 'TRANSFER' ? `${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)}` : `${categoryName} · ${assetName(draft.assetId)}`}</dd>{draft.type === 'EXPENSE' && draft.representativePayment ? <dd className="mt-1 font-semibold text-[var(--muted)]">대표 결제 · 지출 반영 {formatWon(Number(draft.statisticsAmountWon) || 0)}</dd> : null}{draft.type !== 'TRANSFER' && draft.excludedFromStatistics ? <dd className="mt-1 font-semibold text-[var(--muted)]">집계 제외</dd> : null}<dd className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[var(--muted)]"><MemberValue member={member} fallback="현재 구성원에 없음" /><span aria-hidden="true">·</span><span>{draft.description || '내용 없음'}</span></dd></dl>
}


function MemberValue({ member, fallback }: { member?: { memberId: string; displayName: string } | null; fallback: string }) {
  if (!member) return <>{fallback}</>
  return <span className="inline-flex min-w-0 items-center gap-1.5"><MemberAvatar displayName={member.displayName} memberId={member.memberId} size="xs" /><span className="truncate">{member.displayName}</span></span>
}

function TypeButton({ type, selected, onSelect, children }: { type: TransactionType; selected: TransactionType; onSelect: (type: TransactionType) => void; children: string }) {
  const Icon = type === 'EXPENSE' ? ArrowUpRight : type === 'INCOME' ? ArrowDownLeft : ArrowLeftRight
  return <button type="button" aria-pressed={selected===type} onClick={()=>onSelect(type)}><Icon size={17}/>{children}</button>
}
function LoadingState({ label = '거래를 불러오는 중…' }: { label?: string }) { return <div className="grid min-h-56 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />{label}</span></div> }
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="mx-auto max-w-xl py-20 text-center"><p role="alert">{message}</p><Button className="mt-4" variant="secondary" onClick={onRetry}>다시 불러오기</Button></div> }
function NoAssets() { return <div className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">먼저 자산을 등록해 주세요</h1><p className="mt-2 text-sm text-[var(--muted)]">거래 금액이 반영될 현금, 계좌 또는 카드를 먼저 준비해야 해요.</p><Button asChild className="mt-5"><Link to="/assets/new">자산 등록</Link></Button></div> }

function parseDraft(draft: Draft, isCardExpense: boolean): { input?: CreateTransactionInput; errors: FieldErrors } {
  const errors: FieldErrors = {}
  const amountWon = Number(draft.amountWon.replaceAll(',', '').trim())
  if (!Number.isSafeInteger(amountWon) || amountWon <= 0) errors.amountWon = '0원보다 큰 원 단위 정수를 입력해 주세요.'
  if (!draft.occurredOn) errors.occurredOn = '날짜를 선택해 주세요.'
  if (!draft.performedByMemberId) errors.performedByMemberId = performerSelectionError(draft.type)
  if (draft.type === 'TRANSFER') {
    if (!draft.sourceAssetId) errors.sourceAssetId = '보내는 자산을 선택해 주세요.'
    if (!draft.destinationAssetId) errors.destinationAssetId = '받는 자산을 선택해 주세요.'
    if (draft.sourceAssetId && draft.sourceAssetId === draft.destinationAssetId) errors.destinationAssetId = '서로 다른 계좌를 선택해 주세요.'
  } else {
    if (!draft.categoryId) errors.categoryId = '분류를 선택해 주세요.'
    if (!draft.assetId) errors.assetId = '자산을 선택해 주세요.'
  }
  const installmentCount = Number(draft.installmentCount)
  if (isCardExpense && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60)) errors.installmentCount = '1개월부터 60개월 사이로 입력해 주세요.'
  const statisticsAmountWon = draft.representativePayment
    ? Number(draft.statisticsAmountWon.replaceAll(',', '').trim())
    : amountWon
  if (draft.type === 'EXPENSE' && draft.representativePayment
      && (!Number.isSafeInteger(statisticsAmountWon) || statisticsAmountWon < 0 || statisticsAmountWon > amountWon)) {
    errors.statisticsAmountWon = '0원 이상 실제 결제 금액 이하로 입력해 주세요.'
  }
  if (hasFieldErrors(errors)) return { errors }
  const common = { occurredOn: draft.occurredOn, amountWon, performedByMemberId: draft.performedByMemberId, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) }
  if (draft.type === 'INCOME') return { errors, input: { ...common, type: 'INCOME', categoryId: draft.categoryId, assetId: draft.assetId, excludedFromStatistics: draft.excludedFromStatistics } }
  if (draft.type === 'EXPENSE') return { errors, input: { ...common, type: 'EXPENSE', categoryId: draft.categoryId, assetId: draft.assetId, excludedFromStatistics: draft.excludedFromStatistics, statisticsAmountWon, ...(isCardExpense ? { installmentCount } : {}) } }
  return { errors, input: { ...common, type: 'TRANSFER', sourceAssetId: draft.sourceAssetId, destinationAssetId: draft.destinationAssetId, transferPurpose: draft.transferPurpose ?? 'GENERAL' } }
}

function toUpdateInput(input: CreateTransactionInput, expectedVersion: number): UpdateTransactionInput {
  const common = { occurredOn: input.occurredOn, amountWon: input.amountWon, performedByMemberId: input.performedByMemberId, ...(input.description ? { description: input.description } : {}), expectedVersion }
  if (input.type === 'INCOME') return { ...common, type: 'INCOME', categoryId: input.categoryId, assetId: input.assetId, excludedFromStatistics: input.excludedFromStatistics }
  if (input.type === 'EXPENSE') return { ...common, type: 'EXPENSE', categoryId: input.categoryId, assetId: input.assetId, excludedFromStatistics: input.excludedFromStatistics, statisticsAmountWon: input.statisticsAmountWon, ...(input.installmentCount ? { installmentCount: input.installmentCount } : {}) }
  return { ...common, type: 'TRANSFER', sourceAssetId: input.sourceAssetId, destinationAssetId: input.destinationAssetId, transferPurpose: input.transferPurpose }
}

function draftFromTransaction(transaction: Transaction): Draft {
  const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetId ?? ''
  const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetId ?? ''
  return { transferPurpose: transaction.transferPurpose ?? 'GENERAL', type: transaction.type, amountWon: String(transaction.amountWon), occurredOn: transaction.occurredOn, categoryId: transaction.category?.categoryId ?? '', assetId: transaction.asset?.assetId ?? transaction.postings[0]?.assetId ?? '', sourceAssetId: source, destinationAssetId: destination, performedByMemberId: transaction.performedBy?.memberId ?? '', description: transaction.description ?? '', installmentCount: String(transaction.installmentCount ?? 1), excludedFromStatistics: transaction.excludedFromStatistics, representativePayment: transaction.type === 'EXPENSE' && transaction.statisticsAmountWon !== transaction.amountWon, statisticsAmountWon: String(transaction.statisticsAmountWon) }
}

function validNavigationDraft(draft: Draft | undefined, memberId: string, initialDate?: string, initialAssetId?: string, initialSourceAssetId?: string): Draft {
  if (draft && ['INCOME', 'EXPENSE', 'TRANSFER'].includes(draft.type)) return { ...draft, transferPurpose: draft.transferPurpose ?? null, performedByMemberId: draft.performedByMemberId || memberId, excludedFromStatistics: draft.excludedFromStatistics === true, representativePayment: draft.representativePayment === true, statisticsAmountWon: draft.statisticsAmountWon ?? '' }
  const occurredOn = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : todayInSeoul()
  return { transferPurpose: null, type: 'EXPENSE', amountWon: '', occurredOn, categoryId: '', assetId: initialAssetId ?? '', sourceAssetId: initialSourceAssetId ?? '', destinationAssetId: '', performedByMemberId: memberId, description: '', installmentCount: '1', excludedFromStatistics: false, representativePayment: false, statisticsAmountWon: '' }
}

function apiFieldErrors(error: ApiError): FieldErrors { const mapped: FieldErrors = {}; for (const item of error.fieldErrors) if (item.field in defaultDraftKeys) mapped[item.field as keyof Draft] = item.code; for (const [field, message] of Object.entries(error.errors ?? {})) if (field in defaultDraftKeys) mapped[field as keyof Draft] = message; return mapped }
const defaultDraftKeys: Record<keyof Draft, true> = { transferPurpose: true, type: true, amountWon: true, occurredOn: true, categoryId: true, assetId: true, sourceAssetId: true, destinationAssetId: true, performedByMemberId: true, description: true, installmentCount: true, excludedFromStatistics: true, representativePayment: true, statisticsAmountWon: true }
function transferSelection(id: string, accounts: Asset[]) { return accounts.some((asset) => asset.assetId === id) ? id : '' }
function safeReturnTo(state: unknown, occurredOn?: string, fallback?: string) { const value = (state as NavigationState | null)?.returnTo; return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback ?? `/?view=daily&month=${(occurredOn ?? todayInSeoul()).slice(0, 7)}` }
function transferAssetName(id: string, assets: Asset[], ledger: LedgerBook, fallback: string) { const asset = assets.find((item) => item.assetId === id); return asset ? transferAssetLabel(asset, ledger.members) : fallback }
function copyableDraft(draft: Draft, assets: Asset[], categories: Category[], ledger: LedgerBook) { const assetName = (id: string) => draft.type === 'TRANSFER' ? transferAssetName(id, assets, ledger, id) : assets.find((asset) => asset.assetId === id)?.name ?? id; const category = categories.find((item) => item.categoryId === draft.categoryId)?.name ?? draft.categoryId; const member = ledger.members.find((item) => item.memberId === draft.performedByMemberId)?.displayName ?? draft.performedByMemberId; return [`종류: ${typeLabel(draft.type)}`, `날짜: ${draft.occurredOn}`, `금액: ${draft.amountWon}원`, ...(draft.type === 'EXPENSE' && draft.representativePayment ? [`대표 결제 지출 반영: ${draft.statisticsAmountWon}원`] : []), draft.type === 'TRANSFER' ? `자산: ${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)} · ${transferPurposeLabels[draft.transferPurpose ?? 'GENERAL']}` : `분류/자산: ${category} / ${assetName(draft.assetId)}`, ...(draft.type !== 'TRANSFER' ? [`달력·통계: ${draft.excludedFromStatistics ? '집계 제외' : '집계 포함'}`] : []), `${performerPersonLabel(draft.type)}: ${member}`, `내용: ${draft.description}`].join('\n') }
function typeLabel(type: TransactionType) { return type === 'INCOME' ? '수입' : type === 'EXPENSE' ? '지출' : '이체' }
function formatWon(value: number) { return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원` }
function todayInSeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) }

function sameDraft(left: Draft, right: Draft) {
  return (Object.keys(left) as Array<keyof Draft>).every((key) => left[key] === right[key])
}
