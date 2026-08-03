import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Copy, LoaderCircle, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { MoneyField } from '../../components/ui/MoneyField'
import { SelectField } from '../../components/ui/SelectField'
import { TextareaField } from '../../components/ui/TextareaField'
import { ApiError } from '../../lib/api'
import { hasFieldErrors } from '../../lib/formErrors'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetApi, assetKeys, type Asset } from '../assets/api'
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
import { transferAccountAssets } from './transferAssets'
import { CategoryPicker } from './CategoryPicker'
import { PerformerPicker } from './PerformerPicker'

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
}

type FieldErrors = Partial<Record<keyof Draft, string>>
type Conflict = { latest: Transaction; action: 'update' | 'delete' }
type NavigationState = { returnTo?: string; transactionDraft?: Draft }

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
      returnTo={safeReturnTo(location.state, transaction.data?.occurredOn)}
    />
  )
}

function TransactionEditor({ ledger, assets, transaction, initialDraft, returnTo }: { ledger: LedgerBook; assets: Asset[]; transaction?: Transaction; initialDraft?: Draft; returnTo: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const editing = Boolean(transaction)
  const currentMemberId = ledger.members.find((member) => member.currentUser)?.memberId ?? ledger.members[0]?.memberId ?? ''
  const [draft, setDraft] = useState<Draft>(() => transaction ? draftFromTransaction(transaction) : validNavigationDraft(initialDraft, currentMemberId))
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
  const transferAccounts = transferAccountAssets(assets)
  const assetId = editing ? draft.assetId : draft.assetId || assets[0]?.assetId || ''
  const sourceAssetId = transferSelection(draft.sourceAssetId, transferAccounts)
    || (!draft.sourceAssetId && !editing ? transferAccounts[0]?.assetId ?? '' : '')
  const destinationAssetId = transferSelection(draft.destinationAssetId, transferAccounts)
    || (!draft.destinationAssetId && !editing
      ? transferAccounts.find((asset) => asset.assetId !== sourceAssetId)?.assetId ?? ''
      : '')
  const categoryId = editing ? draft.categoryId : draft.categoryId || categories.data?.[0]?.categoryId || ''
  const selectedAsset = assets.find((asset) => asset.assetId === assetId)
  const isCardExpense = !editing && draft.type === 'EXPENSE' && selectedAsset?.behavior === 'CREDIT_CARD'
  const unavailableTransferSelection = draft.type === 'TRANSFER'
    && ((!sourceAssetId && Boolean(draft.sourceAssetId))
      || (!destinationAssetId && Boolean(draft.destinationAssetId)))

  const create = useMutation({
    mutationFn: ({ input, key }: { input: CreateTransactionInput; key: string }) => transactionApi.create(input, key),
    onSuccess: (created) => finishMutation(created, 'transactionSaved'),
  })
  const updateTransaction = useMutation({
    mutationFn: (input: UpdateTransactionInput) => transactionApi.update(transaction!.transactionId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(transactionKeys.detail(updated.transactionId), updated)
      finishMutation(updated, 'transactionUpdated')
    },
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
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
    void queryClient.invalidateQueries({ queryKey: assetKeys.all })
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

  return (
    <AppShell ledgerNavigation>
      <section className="mx-auto max-w-[48rem] py-5 md:py-8">
        <Button asChild variant="ghost"><Link to={returnTo}><ArrowLeft size={17} />가계부로 돌아가기</Link></Button>
        <header className="mt-4 border-b border-[var(--line)] pb-4"><h1 className="text-2xl font-semibold tracking-[-.025em]">{editing ? '거래 수정' : '거래 기록'}</h1><p className="mt-2 text-sm text-[var(--muted)]">본인이 한 기록으로 시작해요. 필요하면 다른 구성원을 선택할 수 있어요.{editing ? ' 거래 종류는 기록 후 바꿀 수 없어요.' : ''}</p></header>

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

        <form className="mt-5" onSubmit={submit} noValidate>
          {hasFieldErrors(errors) ? <p ref={errorSummary} className="mb-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요.</p> : null}

          {editing ? (
            <div className="border-b border-[var(--line)] pb-5"><p className="text-sm font-semibold">거래 종류</p><p className="mt-2 min-h-11 border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm font-semibold" aria-label="거래 종류">{typeLabel(draft.type)}</p></div>
          ) : (
            <fieldset className="border-b border-[var(--line)] pb-5"><legend className="text-sm font-semibold">거래 종류</legend><div className="mt-2 grid grid-cols-3 border border-[var(--line)]"><TypeButton type="INCOME" selected={draft.type} onSelect={selectType}>수입</TypeButton><TypeButton type="EXPENSE" selected={draft.type} onSelect={selectType}>지출</TypeButton><TypeButton type="TRANSFER" selected={draft.type} onSelect={selectType}>이체</TypeButton></div></fieldset>
          )}

          <div className="grid gap-5 border-b border-[var(--line)] py-5 md:grid-cols-[minmax(0,1.35fr)_minmax(13rem,.65fr)]">
            <MoneyField id="transactionAmount" label="금액" value={draft.amountWon} onValueChange={(value) => updateDraft('amountWon', value)} placeholder="0" error={errors.amountWon} autoFocus={!editing} required />
            <Field id="transactionDate" label="날짜" type="date" value={draft.occurredOn} onChange={(event) => updateDraft('occurredOn', event.target.value)} error={errors.occurredOn} required />
          </div>

          {draft.type === 'TRANSFER' ? (
            <div className="grid gap-3 border-b border-[var(--line)] py-5 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
              {transferAccounts.length < 2 ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3] lg:col-span-3" role="status">이체하려면 서로 다른 계좌가 두 개 이상 필요해요. 계좌를 하나 더 등록해 주세요.</p> : null}
              {unavailableTransferSelection ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3] lg:col-span-3" role="status">이 이체에 연결된 자산은 현재 계좌 이체에 사용할 수 없어요. 보내는 계좌와 받는 계좌를 다시 선택해 주세요.</p> : null}
              <SelectField id="sourceAsset" label="보내는 계좌" value={sourceAssetId} onChange={(value) => updateDraft('sourceAssetId', value)} error={errors.sourceAssetId}>{!sourceAssetId ? <option value="">계좌를 선택해 주세요</option> : null}{transferAccounts.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}</SelectField>
              <ArrowRight className="mx-auto mb-3 hidden text-[var(--muted)] lg:block" size={20} />
              <SelectField id="destinationAsset" label="받는 계좌" value={destinationAssetId} onChange={(value) => updateDraft('destinationAssetId', value)} error={errors.destinationAssetId}>{!destinationAssetId ? <option value="">계좌를 선택해 주세요</option> : null}{transferAccounts.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}</SelectField>
            </div>
          ) : (
            <div className={`grid items-start gap-5 border-b border-[var(--line)] py-5 md:grid-cols-2 ${isCardExpense ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(8rem,.55fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]'}`}>
              {categories.isError ? <div className={`border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf] md:col-span-2 ${isCardExpense ? 'lg:col-span-3' : 'lg:col-span-2'}`} role="alert"><p>분류를 불러오지 못했어요. 분류를 확인한 뒤 거래를 저장할 수 있어요.</p><Button className="mt-3" type="button" variant="secondary" onClick={() => categories.refetch()}>분류 다시 불러오기</Button></div> : null}
              <CategoryPicker key={categoryKind} kind={categoryKind} categories={categories.data ?? []} value={categoryId} missingName={transaction?.category?.name} onChange={(value) => updateDraft('categoryId', value)} error={errors.categoryId} disabled={categories.isPending || categories.isError || pending || remoteDeleted} online={online} />
              <SelectField id="transactionAsset" label={draft.type === 'INCOME' ? '입금 자산' : '결제 자산'} value={assetId} onChange={(value) => updateDraft('assetId', value)} error={errors.assetId}>{missingAssetOption(assetId, assets)}{assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {asset.assetTypeName}</option>)}</SelectField>
              {isCardExpense ? <div className="md:col-span-2 md:max-w-40 lg:col-span-1 lg:max-w-none"><Field id="installmentCount" label="할부 개월" hint="일시불은 1개월로 두세요." type="number" min={1} max={60} value={draft.installmentCount} onChange={(event) => updateDraft('installmentCount', event.target.value)} inputMode="numeric" error={errors.installmentCount} required /></div> : null}
            </div>
          )}

          <div className="grid gap-5 border-b border-[var(--line)] py-5">
            <PerformerPicker id="performedBy" label={performerQuestionLabel(draft.type)} members={ledger.members} value={draft.performedByMemberId} onChange={(value) => updateDraft('performedByMemberId', value)} error={errors.performedByMemberId} disabled={pending || remoteDeleted} />
            <TextareaField id="transactionDescription" label="내용 (선택)" value={draft.description} onChange={(value) => updateDraft('description', value)} maxLength={500} />
          </div>

          {!online ? <p className="mt-5 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">인터넷 연결을 확인해 주세요. 입력은 그대로 두었고 연결되면 저장할 수 있어요.</p> : null}
          {mutationError && !(mutationError instanceof ApiError && [404, 412].includes(mutationError.status)) ? <p className="mt-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{mutationError instanceof Error ? mutationError.message : '거래를 저장하지 못했어요.'} 입력은 그대로 두었습니다.</p> : null}
          <div className="mt-5 flex flex-col-reverse gap-3 xs:flex-row xs:justify-end"><Button asChild variant="secondary" size="large"><Link to={returnTo}>취소</Link></Button><Button type="submit" size="large" disabled={pending || !online || remoteDeleted || (draft.type !== 'TRANSFER' && (categories.isPending || categories.isError)) || (draft.type === 'TRANSFER' && (transferAccounts.length < 2 || !sourceAssetId || !destinationAssetId))}>{pending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}{editing ? '변경 저장' : '기록 저장'}</Button></div>
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
  return <AppShell ledgerNavigation><section className="mx-auto max-w-[40rem] py-5 md:py-8"><Button asChild variant="ghost"><Link to={returnTo}><ArrowLeft size={17} />가계부로 돌아가기</Link></Button><header className="mt-4 border-b border-[var(--line)] pb-4"><h1 className="text-2xl font-semibold">{transaction.managementType === 'CARD_PURCHASE' ? '카드 구매' : '자동 기록'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{transaction.managementType === 'CARD_PURCHASE' ? '카드 구매는 카드 결제 흐름과 함께 관리되어 일반 거래 화면에서 수정하거나 삭제할 수 없어요.' : '자동으로 생성된 기록은 일반 거래 화면에서 수정하거나 삭제할 수 없어요.'}</p></header><dl className="grid gap-3 border-b border-[var(--line)] py-5 text-sm sm:grid-cols-2"><div><dt className="text-[var(--muted)]">날짜</dt><dd className="mt-1 font-semibold">{transaction.occurredOn}</dd></div><div><dt className="text-[var(--muted)]">금액</dt><dd className="mt-1 font-semibold">{formatWon(transaction.amountWon)}</dd></div><div><dt className="text-[var(--muted)]">내용</dt><dd className="mt-1 font-semibold">{transaction.description || transaction.category?.name || typeLabel(transaction.type)}</dd></div><div><dt className="text-[var(--muted)]">{performerPersonLabel(transaction.type)}</dt><dd className="mt-1 font-semibold">{transaction.performedBy?.displayName ?? '자동 기록'}</dd></div></dl></section></AppShell>
}

function MissingTransaction({ returnTo }: { returnTo: string }) { return <AppShell ledgerNavigation><section className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">거래를 찾을 수 없어요</h1><p className="mt-2 text-sm text-[var(--muted)]">다른 구성원이 이미 삭제했거나 주소가 올바르지 않을 수 있어요.</p><Button asChild className="mt-5"><Link to={returnTo}>가계부로 돌아가기</Link></Button></section></AppShell> }

function TransactionSummary({ title, draft, assets, categories, ledger }: { title: string; draft: Draft; assets: Asset[]; categories: Category[]; ledger: LedgerBook }) {
  const assetName = (id: string) => assets.find((asset) => asset.assetId === id)?.name ?? '현재 목록에 없음'
  const categoryName = categories.find((category) => category.categoryId === draft.categoryId)?.name ?? '현재 목록에 없음'
  const memberName = ledger.members.find((member) => member.memberId === draft.performedByMemberId)?.displayName ?? '현재 구성원에 없음'
  return <dl className="border-y border-[var(--line)] py-2"><dt className="font-semibold">{title}</dt><dd className="mt-1 text-[var(--muted)]">{draft.occurredOn} · {formatWon(Number(draft.amountWon) || 0)}</dd><dd className="mt-1 text-[var(--muted)]">{draft.type === 'TRANSFER' ? `${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)}` : `${categoryName} · ${assetName(draft.assetId)}`}</dd><dd className="mt-1 text-[var(--muted)]">{memberName} · {draft.description || '내용 없음'}</dd></dl>
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
    if (!draft.sourceAssetId) errors.sourceAssetId = '보내는 계좌를 선택해 주세요.'
    if (!draft.destinationAssetId) errors.destinationAssetId = '받는 계좌를 선택해 주세요.'
    if (draft.sourceAssetId && draft.sourceAssetId === draft.destinationAssetId) errors.destinationAssetId = '서로 다른 계좌를 선택해 주세요.'
  } else {
    if (!draft.categoryId) errors.categoryId = '분류를 선택해 주세요.'
    if (!draft.assetId) errors.assetId = '자산을 선택해 주세요.'
  }
  const installmentCount = Number(draft.installmentCount)
  if (isCardExpense && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60)) errors.installmentCount = '1개월부터 60개월 사이로 입력해 주세요.'
  if (hasFieldErrors(errors)) return { errors }
  const common = { occurredOn: draft.occurredOn, amountWon, performedByMemberId: draft.performedByMemberId, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) }
  if (draft.type === 'INCOME') return { errors, input: { ...common, type: 'INCOME', categoryId: draft.categoryId, assetId: draft.assetId } }
  if (draft.type === 'EXPENSE') return { errors, input: { ...common, type: 'EXPENSE', categoryId: draft.categoryId, assetId: draft.assetId, ...(isCardExpense ? { installmentCount } : {}) } }
  return { errors, input: { ...common, type: 'TRANSFER', sourceAssetId: draft.sourceAssetId, destinationAssetId: draft.destinationAssetId } }
}

function toUpdateInput(input: CreateTransactionInput, expectedVersion: number): UpdateTransactionInput {
  const common = { occurredOn: input.occurredOn, amountWon: input.amountWon, performedByMemberId: input.performedByMemberId, ...(input.description ? { description: input.description } : {}), expectedVersion }
  if (input.type === 'INCOME') return { ...common, type: 'INCOME', categoryId: input.categoryId, assetId: input.assetId }
  if (input.type === 'EXPENSE') return { ...common, type: 'EXPENSE', categoryId: input.categoryId, assetId: input.assetId }
  return { ...common, type: 'TRANSFER', sourceAssetId: input.sourceAssetId, destinationAssetId: input.destinationAssetId }
}

function draftFromTransaction(transaction: Transaction): Draft {
  const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetId ?? ''
  const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetId ?? ''
  return { type: transaction.type, amountWon: String(transaction.amountWon), occurredOn: transaction.occurredOn, categoryId: transaction.category?.categoryId ?? '', assetId: transaction.asset?.assetId ?? transaction.postings[0]?.assetId ?? '', sourceAssetId: source, destinationAssetId: destination, performedByMemberId: transaction.performedBy?.memberId ?? '', description: transaction.description ?? '', installmentCount: String(transaction.installmentCount ?? 1) }
}

function validNavigationDraft(draft: Draft | undefined, memberId: string): Draft {
  if (draft && ['INCOME', 'EXPENSE', 'TRANSFER'].includes(draft.type)) return { ...draft, performedByMemberId: draft.performedByMemberId || memberId }
  return { type: 'EXPENSE', amountWon: '', occurredOn: todayInSeoul(), categoryId: '', assetId: '', sourceAssetId: '', destinationAssetId: '', performedByMemberId: memberId, description: '', installmentCount: '1' }
}

function apiFieldErrors(error: ApiError): FieldErrors { const mapped: FieldErrors = {}; for (const item of error.fieldErrors) if (item.field in defaultDraftKeys) mapped[item.field as keyof Draft] = item.code; for (const [field, message] of Object.entries(error.errors ?? {})) if (field in defaultDraftKeys) mapped[field as keyof Draft] = message; return mapped }
const defaultDraftKeys: Record<keyof Draft, true> = { type: true, amountWon: true, occurredOn: true, categoryId: true, assetId: true, sourceAssetId: true, destinationAssetId: true, performedByMemberId: true, description: true, installmentCount: true }
function transferSelection(id: string, accounts: Asset[]) { return accounts.some((asset) => asset.assetId === id) ? id : '' }
function missingAssetOption(id: string, assets: Asset[]) { return id && !assets.some((asset) => asset.assetId === id) ? <option value={id}>연결했던 자산 (현재 목록에 없음)</option> : null }
function safeReturnTo(state: unknown, occurredOn?: string) { const value = (state as NavigationState | null)?.returnTo; return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : `/?view=daily&month=${(occurredOn ?? todayInSeoul()).slice(0, 7)}` }
function copyableDraft(draft: Draft, assets: Asset[], categories: Category[], ledger: LedgerBook) { const assetName = (id: string) => assets.find((asset) => asset.assetId === id)?.name ?? id; const category = categories.find((item) => item.categoryId === draft.categoryId)?.name ?? draft.categoryId; const member = ledger.members.find((item) => item.memberId === draft.performedByMemberId)?.displayName ?? draft.performedByMemberId; return [`종류: ${typeLabel(draft.type)}`, `날짜: ${draft.occurredOn}`, `금액: ${draft.amountWon}원`, draft.type === 'TRANSFER' ? `자산: ${assetName(draft.sourceAssetId)} → ${assetName(draft.destinationAssetId)}` : `분류/자산: ${category} / ${assetName(draft.assetId)}`, `${performerPersonLabel(draft.type)}: ${member}`, `내용: ${draft.description}`].join('\n') }
function typeLabel(type: TransactionType) { return type === 'INCOME' ? '수입' : type === 'EXPENSE' ? '지출' : '이체' }
function formatWon(value: number) { return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원` }
function todayInSeoul() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) }
