import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Copy, LoaderCircle, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { DatePickerField } from '../../components/ui/DatePickerField'
import { Field } from '../../components/ui/Field'
import { MoneyField } from '../../components/ui/MoneyField'
import { TextareaField } from '../../components/ui/TextareaField'
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
import { PerformerPicker } from './PerformerPicker'
import { StatisticsExclusionSwitch } from './StatisticsExclusionSwitch'

type Draft = {
  type: TransactionType
  amountWon: string
  occurredOn: string
  categoryId: string
  assetId: string
  sourceAssetId: string
  destinationAssetId: string
  performedByMemberId: string
  description: string
  installmentCount: string
  excludedFromStatistics: boolean
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
  if (transaction.data && transaction.data.managementType !== 'GENERAL') return <ManagedTransaction transaction={transaction.data} returnTo={safeReturnTo(location.state)} />
  if (assets.isPending) return <AppShell ledgerNavigation><LoadingState /></AppShell>
  if (assets.isError && !assets.data) return <AppShell ledgerNavigation><LoadError message="거래에 사용할 자산을 불러오지 못했어요." onRetry={() => assets.refetch()} /></AppShell>
  if (!assets.data?.length) return <AppShell ledgerNavigation><NoAssets /></AppShell>

  const state = location.state as NavigationState | null
  return (
    <TransactionEditor
      key={transactionId ?? 'new-transaction'}
      ledger={ledger}
      assets={assets.data}
      transaction={transaction.data}
      initialDraft={!transactionId ? state?.transactionDraft : undefined}
      initialDate={!transactionId ? state?.transactionDate : undefined}
      returnTo={safeReturnTo(location.state, transaction.data?.occurredOn)}
    />
  )
}

function TransactionEditor({ ledger, assets, transaction, initialDraft, initialDate, returnTo }: { ledger: LedgerBook; assets: Asset[]; transaction?: Transaction; initialDraft?: Draft; initialDate?: string; returnTo: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const editing = Boolean(transaction)
  const currentMemberId = ledger.members.find((member) => member.currentUser)?.memberId ?? ledger.members[0]?.memberId ?? ''
  const [draft, setDraft] = useState<Draft>(() => transaction ? draftFromTransaction(transaction) : validNavigationDraft(initialDraft, currentMemberId, initialDate))
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
  const destinationAssetId = transferSelection(draft.destinationAssetId, transferAssets)
    || (!draft.destinationAssetId && !editing
      ? transferAssets.find((asset) => asset.assetId !== sourceAssetId)?.assetId ?? ''
      : '')
  const categoryId = editing ? draft.categoryId : draft.categoryId || categories.data?.[0]?.categoryId || ''
  const selectedAsset = assets.find((asset) => asset.assetId === assetId)
  const isCardExpense = draft.type === 'EXPENSE' && selectedAsset?.behavior === 'CREDIT_CARD'
  const unavailableTransferSelection = draft.type === 'TRANSFER'
    && ((!sourceAssetId && Boolean(draft.sourceAssetId))
      || (!destinationAssetId && Boolean(draft.destinationAssetId)))

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
      navigate(returnTo, { replace: true, state: { transactionDeleted: true } })
    },
    onError: (error) => void handleMutationError(error, 'delete'),
  })

  function finishMutation(saved: Transaction, status: 'transactionSaved' | 'transactionUpdated') {
    // 이 화면에서 활성화된 상세 query가 먼저 재조회되면 일반 거래를 카드 구매로
    // 바꾼 직후 전용 상세 redirect가 목록 복귀보다 앞설 수 있다. 이동할 화면에서
    // 최신 데이터를 읽도록 stale 처리만 하고 현재 route에서는 refetch하지 않는다.
    // 일반 거래는 서버 성공 응답을 상세 cache에도 반영해 다시 편집할 때 이전
    // version으로 초안이 초기화되어 412 충돌이 나는 것을 막는다. 카드 구매 응답은
    // 현재 route의 전용 상세 redirect를 유발할 수 있으므로 cache에 쓰지 않는다.
    if (saved.managementType === 'GENERAL') {
      queryClient.setQueryData(transactionKeys.detail(saved.transactionId), saved)
    }
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all, refetchType: 'none' })
    void queryClient.invalidateQueries({ queryKey: assetKeys.all, refetchType: 'none' })
    void queryClient.invalidateQueries({ queryKey: cardStatementKeys.all, refetchType: 'none' })
    const fallback = `/?view=daily&month=${saved.occurredOn.slice(0, 7)}`
    navigate(editing ? returnTo : fallback, { replace: true, state: { [status]: true } })
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || remoteDeleted) return
    const parsed = parseDraft({ ...draft, assetId, sourceAssetId, destinationAssetId, categoryId }, isCardExpense)
    setErrors(parsed.errors)
    if (!parsed.input) {
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
    setDraft(draftFromTransaction(conflict.latest))
    setBaseVersion(conflict.latest.version)
    setConflict(undefined)
    setErrors({})
    updateTransaction.reset()
    remove.reset()
  }

  function convertToNew() {
    navigate('/transactions/new', { replace: true, state: { transactionDraft: draft, returnTo } satisfies NavigationState })
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(copyableDraft(draft, assets, categories.data ?? [], ledger))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const pending = create.isPending || updateTransaction.isPending
  const mutationError = editing ? updateTransaction.error : create.error
  const resolvedDraft = { ...draft, assetId, sourceAssetId, destinationAssetId, categoryId }

  return (
    <AppShell ledgerNavigation mobileHeader={editing ? { title: '거래 수정', backTo: returnTo, backLabel: '거래 목록으로' } : undefined}>
      <section className="mx-auto max-w-[48rem] py-3 sm:py-5 lg:max-w-[74rem] lg:py-8">
        <header className={`${editing ? 'hidden md:block ' : ''}border-b border-[var(--line)] pb-4`}><h1 className="text-2xl font-semibold tracking-[-.025em]">{editing ? '거래 수정' : '거래 기록'}</h1><p className="mt-2 text-sm text-[var(--muted)]">본인이 한 기록으로 시작해요. 필요하면 다른 구성원을 선택할 수 있어요.{editing ? ' 거래 종류는 기록 후 바꿀 수 없어요.' : ''}</p></header>

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

        <form className="mt-1 lg:mt-6 lg:grid lg:grid-cols-[minmax(0,40rem)_18rem] lg:items-start lg:justify-between lg:gap-8 xl:grid-cols-[minmax(0,40rem)_20rem] xl:gap-10" onSubmit={submit} noValidate>
          <div className="min-w-0">
            {hasFieldErrors(errors) ? <p ref={errorSummary} className="mb-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}

            {editing ? (
              <div className="mb-5"><p className="text-sm font-semibold">거래 종류</p><p className="mt-2 min-h-11 border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm font-semibold" aria-label="거래 종류">{typeLabel(draft.type)}</p></div>
            ) : (
              <fieldset className="mb-5"><legend className="text-sm font-semibold">거래 종류</legend><div className="mt-2 grid grid-cols-3 border border-[var(--line)]"><TypeButton type="INCOME" selected={draft.type} onSelect={selectType}>수입</TypeButton><TypeButton type="EXPENSE" selected={draft.type} onSelect={selectType}>지출</TypeButton><TypeButton type="TRANSFER" selected={draft.type} onSelect={selectType}>이체</TypeButton></div></fieldset>
            )}

          <div className="grid gap-4" data-transaction-fields>
            <MoneyField id="transactionAmount" label="금액" value={draft.amountWon} onValueChange={(value) => updateDraft('amountWon', value)} placeholder="0" error={errors.amountWon} inputClassName="min-h-12 pr-9 text-lg sm:text-xl" autoFocus={!editing} required />
            <DatePickerField id="transactionDate" label="날짜" value={draft.occurredOn} onChange={(value) => updateDraft('occurredOn', value)} error={errors.occurredOn} required />

            {draft.type === 'TRANSFER' ? (
              <div className="grid gap-4 pt-1 xl:grid-cols-[1fr_auto_1fr] xl:items-end">
                {transferAssets.length < 2 ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3] xl:col-span-3" role="status">이체하려면 서로 다른 계좌나 적금이 두 개 이상 필요해요. 계좌 또는 적금을 하나 더 등록해 주세요.</p> : null}
                {unavailableTransferSelection ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3] xl:col-span-3" role="status">이 이체에 연결된 자산은 현재 일반 이체에 사용할 수 없어요. 보내는 자산과 받는 자산을 다시 선택해 주세요.</p> : null}
                <p className="text-xs leading-5 text-[var(--muted)] xl:col-span-3">함께 쓰는 구성원의 계좌·적금과 공동 자산을 모두 선택할 수 있어요.</p>
                <AssetPicker id="sourceAsset" label="보내는 자산" assets={transferAssets} members={ledger.members} value={sourceAssetId} onChange={(value) => updateDraft('sourceAssetId', value)} error={errors.sourceAssetId} placeholder="계좌 또는 적금을 선택해 주세요" required />
                <ArrowRight className="mx-auto mb-3 hidden text-[var(--muted)] xl:block" size={20} />
                <AssetPicker id="destinationAsset" label="받는 자산" assets={transferAssets} members={ledger.members} value={destinationAssetId} onChange={(value) => updateDraft('destinationAssetId', value)} error={errors.destinationAssetId} placeholder="계좌 또는 적금을 선택해 주세요" required />
              </div>
            ) : (
              <>
                {categories.isError ? <div className="border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert"><p>분류를 불러오지 못했어요. 분류를 확인한 뒤 거래를 저장할 수 있어요.</p><Button className="mt-3" type="button" variant="secondary" onClick={() => categories.refetch()}>분류 다시 불러오기</Button></div> : null}
                <CategoryPicker key={categoryKind} kind={categoryKind} categories={categories.data ?? []} value={categoryId} missingName={transaction?.category?.name} onChange={(value) => updateDraft('categoryId', value)} error={errors.categoryId} disabled={categories.isPending || categories.isError || pending || remoteDeleted} online={online} />
                <AssetPicker id="transactionAsset" label={draft.type === 'INCOME' ? '입금 자산' : '결제 자산'} assets={assets} members={ledger.members} value={assetId} onChange={(value) => updateDraft('assetId', value)} missingSelection={transaction?.asset && !assets.some((asset) => asset.assetId === transaction.asset?.assetId) ? { assetId: transaction.asset.assetId, name: transaction.asset.name } : undefined} error={errors.assetId} required />
                {isCardExpense ? <div className="w-full max-w-48"><Field id="installmentCount" label="할부 개월" hint="일시불은 1개월로 두세요." type="number" min={1} max={60} value={draft.installmentCount} onChange={(event) => updateDraft('installmentCount', event.target.value)} inputMode="numeric" error={errors.installmentCount} required /></div> : null}
                <StatisticsExclusionSwitch
                  type={draft.type}
                  checked={draft.excludedFromStatistics}
                  onCheckedChange={(checked) => updateDraft('excludedFromStatistics', checked)}
                  disabled={pending || remoteDeleted}
                  className="border-0 py-1 sm:py-1"
                />
              </>
            )}

            <PerformerPicker id="performedBy" label={performerQuestionLabel(draft.type)} members={ledger.members} value={draft.performedByMemberId} onChange={(value) => updateDraft('performedByMemberId', value)} error={errors.performedByMemberId} disabled={pending || remoteDeleted} />
            <TextareaField id="transactionDescription" label="내용 (선택)" value={draft.description} onChange={(value) => updateDraft('description', value)} maxLength={500} />
          </div>

            {!online ? <p className="mt-5 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">인터넷 연결을 확인해 주세요. 입력은 그대로 두었고 연결되면 저장할 수 있어요.</p> : null}
            {mutationError && !(mutationError instanceof ApiError && [404, 412].includes(mutationError.status)) ? <p className="mt-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{mutationError instanceof Error ? mutationError.message : '거래를 저장하지 못했어요.'} 입력은 그대로 두었습니다.</p> : null}
          </div>

          <aside className="mt-5 border-t border-[var(--line)] pt-5 lg:sticky lg:top-8 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
            <div className="hidden lg:block" data-transaction-desktop-summary>
              <p className="text-xs font-semibold tracking-[.08em] text-[var(--muted)]">현재 입력</p>
              <TransactionDraftSummary draft={resolvedDraft} assets={assets} categories={categories.data ?? []} ledger={ledger} />
            </div>
            <div className="flex flex-col-reverse gap-3 xs:flex-row xs:justify-end lg:mt-6 lg:grid">
              <Button asChild variant="secondary" size="large"><Link to={returnTo}>취소</Link></Button>
              <Button type="submit" size="large" disabled={pending || !online || remoteDeleted || (draft.type !== 'TRANSFER' && (categories.isPending || categories.isError)) || (draft.type === 'TRANSFER' && (transferAssets.length < 2 || !sourceAssetId || !destinationAssetId))}>{pending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}{editing ? '변경 저장' : '기록 저장'}</Button>
            </div>
          </aside>
        </form>

        {editing ? (
          <section className="mt-10 border-t border-[var(--line)] pt-6" aria-labelledby="delete-transaction-title">
            <h2 id="delete-transaction-title" className="text-lg font-semibold">거래 삭제</h2>
            {!confirmDelete ? <Button className="mt-3" type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={remoteDeleted}><Trash2 size={17} />기록 삭제</Button> : <div className="mt-3 border-y border-[var(--line)] py-4"><p className="font-semibold">이 거래를 삭제할까요?</p><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{draft.type === 'TRANSFER' ? '두 자산의 잔액을 함께 되돌립니다.' : '자산 잔액을 되돌리고 해당 월의 수입·지출 통계에서 제외합니다.'}</p>{remove.error && !(remove.error instanceof ApiError && [404, 412].includes(remove.error.status)) ? <p className="mt-3 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{remove.error.message}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={!online || remove.isPending || remoteDeleted} onClick={() => remove.mutate(baseVersion)}>{remove.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}거래 삭제</Button><Button type="button" variant="secondary" onClick={() => { setConfirmDelete(false); remove.reset() }}>취소</Button></div></div>}
          </section>
        ) : null}
      </section>
    </AppShell>
  )
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
  return <dl className="border-y border-[var(--line)] py-2"><dt className="font-semibold">{title}</dt><dd className="mt-1 text-[var(--muted)]">{draft.occurredOn} · {formatWon(Number(draft.amountWon) || 0)}</dd><dd className="mt-1 text-[var(--muted)]">{draft.type === 'TRANSFER' ? `${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)}` : `${categoryName} · ${assetName(draft.assetId)}`}</dd>{draft.type !== 'TRANSFER' && draft.excludedFromStatistics ? <dd className="mt-1 font-semibold text-[var(--muted)]">집계 제외</dd> : null}<dd className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[var(--muted)]"><MemberValue member={member} fallback="현재 구성원에 없음" /><span aria-hidden="true">·</span><span>{draft.description || '내용 없음'}</span></dd></dl>
}

function TransactionDraftSummary({ draft, assets, categories, ledger }: { draft: Draft; assets: Asset[]; categories: Category[]; ledger: LedgerBook }) {
  const assetName = (id: string) => draft.type === 'TRANSFER'
    ? transferAssetName(id, assets, ledger, '선택 안 함')
    : assets.find((asset) => asset.assetId === id)?.name ?? '선택 안 함'
  const categoryName = categories.find((category) => category.categoryId === draft.categoryId)?.name ?? '선택 안 함'
  const member = ledger.members.find((item) => item.memberId === draft.performedByMemberId)
  const amountWon = Number(draft.amountWon.replaceAll(',', ''))
  const flow = draft.type === 'TRANSFER'
    ? `${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)}`
    : `${categoryName} · ${assetName(draft.assetId)}`

  return (
    <dl className="mt-3 border-y border-[var(--line)] py-4 text-sm">
      <div className="flex items-center justify-between gap-4"><dt className="text-[var(--muted)]">구분</dt><dd className="font-semibold">{typeLabel(draft.type)}</dd></div>
      <div className="mt-4"><dt className="text-[var(--muted)]">금액</dt><dd className={`mt-1 text-2xl font-semibold tracking-[-.03em] tabular-nums ${draft.type === 'EXPENSE' ? 'text-[var(--expense)]' : draft.type === 'INCOME' ? 'text-[var(--income)]' : 'text-[var(--transfer)]'}`}>{Number.isSafeInteger(amountWon) && amountWon > 0 ? formatWon(amountWon) : '금액 미입력'}</dd></div>
      <div className="mt-4"><dt className="text-[var(--muted)]">날짜</dt><dd className="mt-1 font-semibold tabular-nums">{draft.occurredOn || '선택 안 함'}</dd></div>
      <div className="mt-4"><dt className="text-[var(--muted)]">흐름</dt><dd className="mt-1 break-words font-semibold leading-6">{flow}</dd></div>
      {draft.type !== 'TRANSFER' ? <div className="mt-4"><dt className="text-[var(--muted)]">달력·통계</dt><dd className="mt-1 font-semibold">{draft.excludedFromStatistics ? '집계 제외' : '집계 포함'}</dd></div> : null}
      <div className="mt-4"><dt className="text-[var(--muted)]">{performerPersonLabel(draft.type)}</dt><dd className="mt-1 font-semibold"><MemberValue member={member} fallback="선택 안 함" /></dd></div>
      {draft.description ? <div className="mt-4"><dt className="text-[var(--muted)]">내용</dt><dd className="mt-1 break-words leading-6">{draft.description}</dd></div> : null}
    </dl>
  )
}

function MemberValue({ member, fallback }: { member?: { memberId: string; displayName: string } | null; fallback: string }) {
  if (!member) return <>{fallback}</>
  return <span className="inline-flex min-w-0 items-center gap-1.5"><MemberAvatar displayName={member.displayName} memberId={member.memberId} size="xs" /><span className="truncate">{member.displayName}</span></span>
}

function TypeButton({ type, selected, onSelect, children }: { type: TransactionType; selected: TransactionType; onSelect: (type: TransactionType) => void; children: string }) { return <Button variant="ghost" className={`rounded-none border-r border-[var(--line)] px-3 last:border-r-0 ${selected === type ? 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-white' : 'bg-[var(--surface)] text-[var(--muted)] hover:text-ink-900 dark:hover:text-white'}`} type="button" aria-pressed={selected === type} onClick={() => onSelect(type)}>{children}</Button> }
function LoadingState() { return <div className="grid min-h-[70dvh] place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />거래를 불러오는 중…</span></div> }
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
  if (hasFieldErrors(errors)) return { errors }
  const common = { occurredOn: draft.occurredOn, amountWon, performedByMemberId: draft.performedByMemberId, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) }
  if (draft.type === 'INCOME') return { errors, input: { ...common, type: 'INCOME', categoryId: draft.categoryId, assetId: draft.assetId, excludedFromStatistics: draft.excludedFromStatistics } }
  if (draft.type === 'EXPENSE') return { errors, input: { ...common, type: 'EXPENSE', categoryId: draft.categoryId, assetId: draft.assetId, excludedFromStatistics: draft.excludedFromStatistics, ...(isCardExpense ? { installmentCount } : {}) } }
  return { errors, input: { ...common, type: 'TRANSFER', sourceAssetId: draft.sourceAssetId, destinationAssetId: draft.destinationAssetId } }
}

function toUpdateInput(input: CreateTransactionInput, expectedVersion: number): UpdateTransactionInput {
  const common = { occurredOn: input.occurredOn, amountWon: input.amountWon, performedByMemberId: input.performedByMemberId, ...(input.description ? { description: input.description } : {}), expectedVersion }
  if (input.type === 'INCOME') return { ...common, type: 'INCOME', categoryId: input.categoryId, assetId: input.assetId, excludedFromStatistics: input.excludedFromStatistics }
  if (input.type === 'EXPENSE') return { ...common, type: 'EXPENSE', categoryId: input.categoryId, assetId: input.assetId, excludedFromStatistics: input.excludedFromStatistics, ...(input.installmentCount ? { installmentCount: input.installmentCount } : {}) }
  return { ...common, type: 'TRANSFER', sourceAssetId: input.sourceAssetId, destinationAssetId: input.destinationAssetId }
}

function draftFromTransaction(transaction: Transaction): Draft {
  const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetId ?? ''
  const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetId ?? ''
  return { type: transaction.type, amountWon: String(transaction.amountWon), occurredOn: transaction.occurredOn, categoryId: transaction.category?.categoryId ?? '', assetId: transaction.asset?.assetId ?? transaction.postings[0]?.assetId ?? '', sourceAssetId: source, destinationAssetId: destination, performedByMemberId: transaction.performedBy?.memberId ?? '', description: transaction.description ?? '', installmentCount: String(transaction.installmentCount ?? 1), excludedFromStatistics: transaction.excludedFromStatistics }
}

function validNavigationDraft(draft: Draft | undefined, memberId: string, initialDate?: string): Draft {
  if (draft && ['INCOME', 'EXPENSE', 'TRANSFER'].includes(draft.type)) return { ...draft, performedByMemberId: draft.performedByMemberId || memberId, excludedFromStatistics: draft.excludedFromStatistics === true }
  const occurredOn = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : todayInSeoul()
  return { type: 'EXPENSE', amountWon: '', occurredOn, categoryId: '', assetId: '', sourceAssetId: '', destinationAssetId: '', performedByMemberId: memberId, description: '', installmentCount: '1', excludedFromStatistics: false }
}

function apiFieldErrors(error: ApiError): FieldErrors { const mapped: FieldErrors = {}; for (const item of error.fieldErrors) if (item.field in defaultDraftKeys) mapped[item.field as keyof Draft] = item.code; for (const [field, message] of Object.entries(error.errors ?? {})) if (field in defaultDraftKeys) mapped[field as keyof Draft] = message; return mapped }
const defaultDraftKeys: Record<keyof Draft, true> = { type: true, amountWon: true, occurredOn: true, categoryId: true, assetId: true, sourceAssetId: true, destinationAssetId: true, performedByMemberId: true, description: true, installmentCount: true, excludedFromStatistics: true }
function transferSelection(id: string, accounts: Asset[]) { return accounts.some((asset) => asset.assetId === id) ? id : '' }
function safeReturnTo(state: unknown, occurredOn?: string) { const value = (state as NavigationState | null)?.returnTo; return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : `/?view=daily&month=${(occurredOn ?? todayInSeoul()).slice(0, 7)}` }
function transferAssetName(id: string, assets: Asset[], ledger: LedgerBook, fallback: string) { const asset = assets.find((item) => item.assetId === id); return asset ? transferAssetLabel(asset, ledger.members) : fallback }
function copyableDraft(draft: Draft, assets: Asset[], categories: Category[], ledger: LedgerBook) { const assetName = (id: string) => draft.type === 'TRANSFER' ? transferAssetName(id, assets, ledger, id) : assets.find((asset) => asset.assetId === id)?.name ?? id; const category = categories.find((item) => item.categoryId === draft.categoryId)?.name ?? draft.categoryId; const member = ledger.members.find((item) => item.memberId === draft.performedByMemberId)?.displayName ?? draft.performedByMemberId; return [`종류: ${typeLabel(draft.type)}`, `날짜: ${draft.occurredOn}`, `금액: ${draft.amountWon}원`, draft.type === 'TRANSFER' ? `자산: ${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)}` : `분류/자산: ${category} / ${assetName(draft.assetId)}`, ...(draft.type !== 'TRANSFER' ? [`달력·통계: ${draft.excludedFromStatistics ? '집계 제외' : '집계 포함'}`] : []), `${performerPersonLabel(draft.type)}: ${member}`, `내용: ${draft.description}`].join('\n') }
function typeLabel(type: TransactionType) { return type === 'INCOME' ? '수입' : type === 'EXPENSE' ? '지출' : '이체' }
function formatWon(value: number) { return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원` }
function todayInSeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) }
