import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, ArrowLeft, Link2, LoaderCircle, RotateCcw, Save, Trash2, WalletCards, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberPicker } from '../../components/MemberPicker'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { MoneyField } from '../../components/ui/MoneyField'
import { RadioGroup, RadioGroupItem } from '../../components/ui/RadioGroup'
import { SelectField } from '../../components/ui/SelectField'
import { Switch } from '../../components/ui/Switch'
import { TextareaField } from '../../components/ui/TextareaField'
import { ApiError } from '../../lib/api'
import { hasFieldErrors } from '../../lib/formErrors'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { CardStatementListSection } from '../card-statements/CardStatementListSection'
import type { LedgerBook } from '../membership/api'
import { transactionKeys } from '../transactions/api'
import {
  assetApi,
  assetKeys,
  type Asset,
  type AssetBehavior,
  type AssetRemovalPreview,
  type AssetRemovalResult,
  type AssetType,
  type CardSettingsInput,
  type CreateAssetInput,
  type DebitCardSettings,
  type OwnershipScope,
  type SavingsSettings,
  type UpdateAssetInput,
} from './api'
import { resolveAssetName } from './assetName'
import { formatWon, todayInSeoul } from './format'
import { blockingLinkKindLabel, removalActionLabel, removalDescription, removalTitle, removalWarnings } from './removal'

const ASSET_LIMIT = 50
const archivedAtFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })

type AssetDraft = {
  assetTypeId: string
  ownershipScope: OwnershipScope
  ownerMemberId: string
  name: string
  openedOn: string
  memo: string
  openingBalanceWon: string
  statementClosingDay: string
  paymentDay: string
  paymentMonthOffset: string
  settlementAssetId: string
  autoSettlementEnabled: boolean
  debitCardPaymentAssetId: string
  savingsAutoTransferEnabled: boolean
  savingsTransferAssetId: string
  savingsTransferDay: string
  expectedVersion: number
  reassignTransactionsToNewOwner: boolean
}

type FieldErrors = Partial<Record<keyof AssetDraft, string>>
type SaveCommand = { kind: 'create'; input: CreateAssetInput; idempotencyKey: string } | { kind: 'update'; input: UpdateAssetInput }
type PaymentSourceTarget = 'settlementAssetId' | 'debitCardPaymentAssetId' | 'savingsTransferAssetId'

const CREATE_VISIBLE_FIELDS = new Set<keyof AssetDraft>(['assetTypeId', 'name', 'openingBalanceWon', 'openedOn'])
const EDIT_VISIBLE_FIELDS = new Set<keyof AssetDraft>([
  'assetTypeId',
  'ownershipScope',
  'ownerMemberId',
  'name',
  'openedOn',
  'memo',
  'openingBalanceWon',
  'reassignTransactionsToNewOwner',
])
const CARD_SETTING_FIELDS = new Set<keyof AssetDraft>([
  'statementClosingDay',
  'paymentDay',
  'paymentMonthOffset',
  'settlementAssetId',
  'autoSettlementEnabled',
])
const DEBIT_CARD_SETTING_FIELDS = new Set<keyof AssetDraft>(['debitCardPaymentAssetId'])
const SAVINGS_SETTING_FIELDS = new Set<keyof AssetDraft>(['savingsAutoTransferEnabled', 'savingsTransferAssetId', 'savingsTransferDay'])

export function AssetFormPage({ ledger }: { ledger: LedgerBook }) {
  const { assetId } = useParams()
  const [searchParams] = useSearchParams()
  const editing = Boolean(assetId)
  const types = useQuery({ queryKey: assetKeys.types, queryFn: assetApi.types, staleTime: 5 * 60 * 1000 })
  const assets = useQuery({ queryKey: assetKeys.list, queryFn: assetApi.list, staleTime: 0, refetchOnWindowFocus: 'always' })
  const detail = useQuery({
    queryKey: assetKeys.detail(assetId ?? ''),
    queryFn: () => assetApi.detail(assetId ?? ''),
    enabled: editing,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })

  const pending = types.isPending || assets.isPending || (editing && detail.isPending)
  const unavailable = (types.isError && !types.data) || (assets.isError && !assets.data) || (editing && detail.isError && !detail.data)
  const backgroundError = Boolean((types.isError && types.data) || (assets.isError && assets.data) || (editing && detail.isError && detail.data))
  const remoteDeleted = Boolean(editing && detail.data && detail.error instanceof ApiError && detail.error.status === 404)

  return (
    <AppShell ledgerNavigation>
      <section className="py-5 md:py-8">
        <Button asChild variant="ghost"><Link to="/assets"><ArrowLeft size={17} />자산 목록</Link></Button>
        {pending ? (
          <div className="grid min-h-[28rem] place-items-center text-center"><div><LoaderCircle className="mx-auto animate-spin text-forest-600 dark:text-forest-100" size={34} /><p className="mt-3 text-sm text-[var(--muted)]">자산 정보를 준비하는 중…</p></div></div>
        ) : unavailable || !types.data || !assets.data || (editing && !detail.data) ? (
          <div className="mt-6 border-y border-[var(--line)] py-10 text-center">
            <p role="alert">자산 정보를 불러오지 못했어요.</p>
            <Button className="mt-4" variant="secondary" onClick={() => { types.refetch(); assets.refetch(); if (editing) detail.refetch() }}>다시 불러오기</Button>
          </div>
        ) : !editing && assets.data.length >= ASSET_LIMIT ? (
          <div className="mt-6 border-y border-[var(--line)] py-10 text-center"><p className="font-semibold">활성 자산을 50개까지 모두 등록했어요.</p><p className="mt-2 text-sm text-[var(--muted)]">기존 자산을 정리한 뒤 다시 등록해 주세요.</p><Button asChild className="mt-5" variant="secondary"><Link to="/assets">목록으로 돌아가기</Link></Button></div>
        ) : editing && assetId && detail.data ? (
          <ExistingAssetContent
            key={assetId}
            asset={detail.data}
            assetId={assetId}
            assets={assets.data}
            backgroundError={backgroundError}
            ledger={ledger}
            remoteDeleted={remoteDeleted}
            types={types.data}
            refreshLatest={async () => {
              const result = await detail.refetch()
              if (result.error || !result.data) throw result.error ?? new Error('최신 자산 정보를 불러오지 못했어요.')
              return result.data
            }}
          />
        ) : (
          <div>
            <AssetEditor
              key="new"
              ledger={ledger}
              types={types.data}
              assets={assets.data}
              initialAsset={undefined}
              preferredSystemCode={searchParams.get('type')}
              backgroundError={backgroundError}
              remoteDeleted={false}
              remoteArchived={false}
              refreshLatest={async () => { throw new Error('새 자산에는 최신 버전이 없습니다.') }}
            />
          </div>
        )}
      </section>
    </AppShell>
  )
}

function ExistingAssetContent({ asset, assetId, assets, backgroundError, ledger, remoteDeleted, types, refreshLatest }: {
  asset: Asset
  assetId: string
  assets: Asset[]
  backgroundError: boolean
  ledger: LedgerBook
  remoteDeleted: boolean
  types: AssetType[]
  refreshLatest: () => Promise<Asset>
}) {
  const [openedStatus] = useState(asset.status)
  const remoteArchived = openedStatus === 'ACTIVE' && asset.status === 'ARCHIVED'
  return (
    <div className="lg:grid lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <AssetDesktopList assets={assets} selectedAssetId={assetId} />
      {openedStatus === 'ARCHIVED'
        ? <ArchivedAssetDetail asset={asset} assets={assets} ledger={ledger} />
        : <AssetEditor ledger={ledger} types={types} assets={assets} initialAsset={asset} preferredSystemCode={null} backgroundError={backgroundError} remoteDeleted={remoteDeleted} remoteArchived={remoteArchived} refreshLatest={refreshLatest} />}
    </div>
  )
}

function AssetDesktopList({ assets, selectedAssetId }: { assets: Asset[]; selectedAssetId: string }) {
  return (
    <aside className="sticky top-6 mt-5 hidden max-h-[calc(100dvh-3rem)] overflow-y-auto border-y border-[var(--line)] py-3 lg:block" aria-label="자산 목록">
      <div className="flex items-center justify-between gap-2 px-2 py-2"><h2 className="font-semibold">자산 목록</h2><Button asChild variant="ghost" size="icon"><Link to="/assets/new" aria-label="자산 추가"><WalletCards size={18} /></Link></Button></div>
      <nav className="mt-1 divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {assets.map((asset) => (
          <Link key={asset.assetId} to={`/assets/${asset.assetId}`} aria-current={asset.assetId === selectedAssetId ? 'page' : undefined} className={`block border-l-2 px-3 py-3 text-sm transition-colors ${asset.assetId === selectedAssetId ? 'border-forest-600 text-forest-800 dark:text-forest-100' : 'border-transparent text-[var(--muted)] hover:text-forest-800 dark:hover:text-white'}`}>
            <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate font-semibold">{asset.name}</span><span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{asset.assetTypeName}</span></span><span className="shrink-0 font-semibold tabular-nums">{formatWon(asset.currentBalanceWon)}</span></span>
          </Link>
        ))}
      </nav>
    </aside>
  )
}

function AssetEditor({ ledger, types, assets, initialAsset, preferredSystemCode, backgroundError, remoteDeleted, remoteArchived, refreshLatest }: {
  ledger: LedgerBook
  types: AssetType[]
  assets: Asset[]
  initialAsset?: Asset
  preferredSystemCode: string | null
  backgroundError: boolean
  remoteDeleted: boolean
  remoteArchived: boolean
  refreshLatest: () => Promise<Asset>
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const editing = Boolean(initialAsset)
  const [draft, setDraft] = useState<AssetDraft>(() => initialAsset ? draftFromAsset(initialAsset) : newDraft(types, ledger, preferredSystemCode))
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [conflict, setConflict] = useState(false)
  const [conflictLatest, setConflictLatest] = useState<Asset>()
  const [conflictLoading, setConflictLoading] = useState(false)
  const [conflictLoadError, setConflictLoadError] = useState(false)
  const [rebased, setRebased] = useState(false)
  const [saved, setSaved] = useState(false)
  const [paymentSourceTarget, setPaymentSourceTarget] = useState<PaymentSourceTarget>()
  const online = useOnlineStatus()
  const idempotency = useRef<{ fingerprint: string; key: string } | undefined>(undefined)
  const errorSummary = useRef<HTMLParagraphElement | null>(null)
  const paymentSourceTrigger = useRef<HTMLButtonElement | null>(null)
  const focusAfterPaymentSourceClose = useRef<string | undefined>(undefined)
  const selectedType = types.find((type) => type.assetTypeId === draft.assetTypeId)
  const isCreditCard = selectedType?.behavior === 'CREDIT_CARD'
  const isDebitCard = selectedType?.behavior === 'DEBIT_CARD'
  const isSavings = selectedType?.behavior === 'SAVINGS'
  const fallbackAssetName = resolveAssetName({
    draftName: '',
    typeName: selectedType?.name ?? '',
    assets,
    excludedAssetId: initialAsset?.assetId,
  })
  const resolvedAssetName = draft.name.trim() || fallbackAssetName
  const selectedTypeDisplayName = selectedType?.name ?? '선택한 자산 종류'
  const amountLabel = selectedType?.systemCode === 'LOAN' ? '기준일 대출 잔액' : '기준일 잔액'
  const paymentSourceCandidates = assets.filter((asset) => asset.paymentSourceCapable && asset.assetId !== initialAsset?.assetId)
  const ownerChangedToPersonal = Boolean(initialAsset)
    && draft.ownershipScope === 'PERSONAL'
    && (initialAsset?.ownershipScope !== 'PERSONAL' || initialAsset.ownerMemberId !== draft.ownerMemberId)

  const saveAsset = useMutation({
    mutationFn: (command: SaveCommand) => command.kind === 'create'
      ? assetApi.create(command.input, command.idempotencyKey)
      : assetApi.update(initialAsset?.assetId ?? '', command.input),
    onSuccess: (asset, command) => {
      if (command.kind === 'create') {
        queryClient.setQueryData<Asset[]>(assetKeys.list, (current) => appendCreatedAsset(current, asset))
        void queryClient.invalidateQueries({ queryKey: assetKeys.all })
        navigate('/assets', { replace: true, state: { assetCreated: true, createdAssetId: asset.assetId } })
        return
      }

      queryClient.setQueryData(assetKeys.detail(asset.assetId), asset)
      void queryClient.invalidateQueries({ queryKey: assetKeys.all })
      void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      setConflict(false)
      setSaved(true)
      setDraft(draftFromAsset(asset))
    },
    onError: (error, command) => {
      setSaved(false)
      if (error instanceof ApiError) {
        const apiFieldErrors = fieldErrorsFromApi(error, command.kind === 'update', command.input)
        setFieldErrors(apiFieldErrors)
        if (hasFieldErrors(apiFieldErrors)) requestAnimationFrame(() => errorSummary.current?.focus())
      }
      if (error instanceof ApiError && error.status === 412) {
        setConflict(true)
        void loadConflictLatest()
      }
    },
  })

  function update<K extends keyof AssetDraft>(key: K, value: AssetDraft[K]) {
    setSaved(false)
    setRebased(false)
    setFieldErrors((current) => ({ ...current, [key]: undefined }))
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function openPaymentSourceDialog(target: PaymentSourceTarget, trigger: HTMLButtonElement) {
    paymentSourceTrigger.current = trigger
    focusAfterPaymentSourceClose.current = undefined
    setPaymentSourceTarget(target)
  }

  const closePaymentSourceDialog = useCallback(() => {
    setPaymentSourceTarget(undefined)
    const focusId = focusAfterPaymentSourceClose.current
    focusAfterPaymentSourceClose.current = undefined
    requestAnimationFrame(() => {
      if (focusId) document.getElementById(focusId)?.focus()
      else paymentSourceTrigger.current?.focus()
    })
  }, [])

  function selectCreatedPaymentSource(asset: Asset) {
    if (!paymentSourceTarget) return
    focusAfterPaymentSourceClose.current = paymentSourceTarget === 'settlementAssetId'
      ? 'settlementAsset'
      : paymentSourceTarget === 'debitCardPaymentAssetId'
        ? 'debitCardPaymentAsset'
        : 'savingsTransferAsset'
    update(paymentSourceTarget, asset.assetId)
  }

  function selectAssetType(assetTypeId: string) {
    setSaved(false)
    setRebased(false)
    setFieldErrors((current) => ({
      ...current,
      assetTypeId: undefined,
      statementClosingDay: undefined,
      paymentDay: undefined,
      paymentMonthOffset: undefined,
      settlementAssetId: undefined,
      autoSettlementEnabled: undefined,
      debitCardPaymentAssetId: undefined,
      savingsAutoTransferEnabled: undefined,
      savingsTransferAssetId: undefined,
      savingsTransferDay: undefined,
    }))
    setDraft((current) => ({ ...current, assetTypeId }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online) return
    setRebased(false)
    const parsed = parseDraft(draft, selectedType, resolvedAssetName, editing)
    setFieldErrors(parsed.errors)
    if (!parsed.input) {
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }

    if (editing) {
      saveAsset.mutate({ kind: 'update', input: { ...parsed.input, expectedVersion: draft.expectedVersion, reassignTransactionsToNewOwner: ownerChangedToPersonal && draft.reassignTransactionsToNewOwner } })
      return
    }
    const fingerprint = JSON.stringify(parsed.input)
    if (!idempotency.current || idempotency.current.fingerprint !== fingerprint) idempotency.current = { fingerprint, key: crypto.randomUUID() }
    saveAsset.mutate({ kind: 'create', input: parsed.input, idempotencyKey: idempotency.current.key })
  }

  function applyDraftToLatest() {
    if (!conflictLatest) return
    setDraft((current) => ({ ...current, expectedVersion: conflictLatest.version }))
    setConflict(false)
    setRebased(true)
    saveAsset.reset()
  }

  function useLatestValues() {
    if (!conflictLatest) return
    setDraft(draftFromAsset(conflictLatest))
    setConflict(false)
    setRebased(false)
    setFieldErrors({})
    saveAsset.reset()
  }

  async function loadConflictLatest() {
    setConflictLoading(true)
    setConflictLoadError(false)
    setConflictLatest(undefined)
    try {
      setConflictLatest(await refreshLatest())
    } catch {
      setConflictLoadError(true)
    } finally {
      setConflictLoading(false)
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-[48rem]">
      <h1 className="text-2xl font-semibold tracking-[-.025em]">{editing ? '자산 정보 수정' : '자산 등록'}</h1>
      {initialAsset ? (
        <dl className="mt-4 grid gap-x-5 gap-y-2 border-y border-[var(--line)] py-3 text-sm min-[30rem]:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">현재 장부 잔액</dt><dd className="font-semibold tabular-nums">{formatWon(initialAsset.currentBalanceWon)}</dd></div>
          {initialAsset.behavior === 'CREDIT_CARD' ? <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">이번 달 결제 예정</dt><dd className="font-semibold tabular-nums">{formatWon(initialAsset.currentMonthCardPaymentDueWon)}</dd></div> : null}
        </dl>
      ) : null}
      {initialAsset?.behavior === 'CREDIT_CARD' ? <CardStatementListSection cardAsset={initialAsset} assets={assets} /> : null}

      <form className={initialAsset?.behavior === 'CREDIT_CARD' ? 'mt-8 border-t border-[var(--line)] pt-5' : 'mt-4'} onSubmit={submit} noValidate>
        {initialAsset?.behavior === 'CREDIT_CARD' ? <h2 className="mb-4 text-lg font-semibold">자산 설정</h2> : null}
        {hasFieldErrors(fieldErrors) ? <p ref={errorSummary} className="mb-4 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 outline-none dark:text-[#ffd5cf]" role="alert" tabIndex={-1}>입력하지 않았거나 확인이 필요한 항목이 있어요. 표시된 내용을 확인해 주세요.</p> : null}
        <div className="grid gap-4">
          <div>
            <p id="asset-type-label" className="text-sm font-semibold">자산 종류</p>
            <div
              className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5"
              role="group"
              aria-labelledby="asset-type-label"
              aria-invalid={Boolean(fieldErrors.assetTypeId)}
              aria-describedby={fieldErrors.assetTypeId ? 'asset-type-error' : undefined}
            >
              {types.map((type) => {
                const selected = type.assetTypeId === draft.assetTypeId
                return (
                  <Button
                    key={type.assetTypeId}
                    variant="secondary"
                    className={`min-h-11 min-w-0 whitespace-normal break-words rounded-md border px-1.5 py-1.5 text-sm leading-tight font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 ${selected ? 'border-forest-700 bg-forest-50 text-forest-800 dark:bg-forest-950 dark:text-forest-100' : 'border-[var(--line)] bg-transparent text-ink-900 hover:border-forest-600 hover:bg-forest-50 dark:text-white dark:hover:bg-forest-950'}`}
                    type="button"
                    aria-pressed={selected}
                    autoFocus={!editing && selected}
                    onClick={(event) => {
                      selectAssetType(type.assetTypeId)
                      event.currentTarget.focus()
                    }}
                  >
                    {type.name}
                  </Button>
                )
              })}
            </div>
            {fieldErrors.assetTypeId ? <p id="asset-type-error" className="mt-2 text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{fieldErrors.assetTypeId}</p> : null}
          </div>
          <Field
            id="assetName"
            name="assetName"
            label="자산 이름 (선택)"
            hint={fallbackAssetName ? `비워 두면 ‘${fallbackAssetName}’으로 저장해요.` : '비워 두면 선택한 자산 종류 이름으로 저장해요.'}
            value={draft.name}
            onChange={(event) => update('name', event.target.value)}
            maxLength={100}
            placeholder={fallbackAssetName}
            error={fieldErrors.name}
          />
          {editing ? <>
            <fieldset>
              <legend className="text-sm font-semibold">소유 형태</legend>
              <RadioGroup className="mt-2 grid grid-cols-2 divide-x divide-[var(--line)] border-y border-[var(--line)]" value={draft.ownershipScope} onValueChange={(value) => { const scope = value as AssetDraft['ownershipScope']; update('ownershipScope', scope); if (scope === 'JOINT') update('reassignTransactionsToNewOwner', false) }}>
                <OwnershipOption label="구성원 소유" description="구성원 한 명의 자산" value="PERSONAL" checked={draft.ownershipScope === 'PERSONAL'} />
                <OwnershipOption label="공동 소유" description="가계부 구성원의 공동 자산" value="JOINT" checked={draft.ownershipScope === 'JOINT'} />
              </RadioGroup>
            </fieldset>
            {draft.ownershipScope === 'PERSONAL' ? <MemberPicker id="ownerMember" label="소유자" members={ledger.members} value={draft.ownerMemberId} onChange={(value) => update('ownerMemberId', value)} error={fieldErrors.ownerMemberId} /> : null}
            {ownerChangedToPersonal ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 border-y border-[var(--line)] px-1 py-3" htmlFor="reassignTransactionsToNewOwner">
                <Checkbox id="reassignTransactionsToNewOwner" className="mt-1" checked={draft.reassignTransactionsToNewOwner} onCheckedChange={(checked) => update('reassignTransactionsToNewOwner', checked)} />
                <span><span className="block text-sm font-semibold">기존 수입·지출의 구성원도 변경</span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">이 자산에 연결된 기존 기록도 새 소유자의 수입·지출로 바꿔요. 이체는 바꾸지 않아요.</span></span>
              </label>
            ) : null}
          </> : null}
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(13rem,.65fr)] md:gap-5">
            <MoneyField id="openingBalanceWon" name="openingBalanceWon" label={amountLabel} hint="이 날짜가 시작될 때 실제로 있던 금액이에요. 비우면 0원, 부채는 - 금액으로 등록해요." value={draft.openingBalanceWon} onValueChange={(value) => update('openingBalanceWon', value)} placeholder="0" error={fieldErrors.openingBalanceWon} allowNegative />
            <Field id="openedOn" name="openedOn" label="잔액 기준일" hint="이 날짜보다 앞선 기록은 통계에는 남지만 현재 잔액을 바꾸지 않아요." value={draft.openedOn} onChange={(event) => update('openedOn', event.target.value)} type="date" error={fieldErrors.openedOn} required />
          </div>
          {editing ? <TextareaField id="assetMemo" name="assetMemo" label="메모 (선택)" value={draft.memo} onChange={(value) => update('memo', value)} maxLength={1000} error={fieldErrors.memo} /> : null}
        </div>

        {isCreditCard ? <CardSettingsFields editing={editing} draft={draft} update={update} errors={fieldErrors} candidates={paymentSourceCandidates} onCreatePaymentSource={(trigger) => openPaymentSourceDialog('settlementAssetId', trigger)} /> : null}
        {isDebitCard ? <DebitCardSettingsFields draft={draft} update={update} errors={fieldErrors} candidates={paymentSourceCandidates} onCreatePaymentSource={(trigger) => openPaymentSourceDialog('debitCardPaymentAssetId', trigger)} /> : null}
        {isSavings ? <SavingsSettingsFields draft={draft} update={update} errors={fieldErrors} candidates={paymentSourceCandidates} onCreatePaymentSource={(trigger) => openPaymentSourceDialog('savingsTransferAssetId', trigger)} /> : null}

        {!online ? <p className="mt-6 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">인터넷 연결을 확인해 주세요. 입력은 그대로 두었고 연결되면 저장할 수 있어요.</p> : null}
        {remoteDeleted ? <p className="mt-6 border-l-4 border-red-600 px-4 py-2 text-sm leading-6 text-red-800 dark:text-[#ffd5cf]" role="alert">이 자산을 더 이상 찾을 수 없어요. 작성 중인 입력은 이 화면에 그대로 두었지만 저장할 수는 없습니다. 필요한 내용을 확인한 뒤 자산 목록으로 돌아가 주세요.</p> : remoteArchived ? <p className="mt-6 border-l-4 border-amber-500 px-4 py-2 text-sm leading-6 text-amber-950 dark:text-[#ffe3a3]" role="alert">다른 구성원이 이 자산을 보관했어요. 작성 중인 입력은 그대로 두었지만 저장할 수 없습니다. 필요한 내용을 확인한 뒤 자산 목록으로 돌아가 주세요.</p> : backgroundError && !conflict ? <p className="mt-6 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">최신값을 확인하지 못했어요. 작성 중인 입력은 그대로 두었습니다.</p> : null}
        {conflict ? <ConflictPanel latest={conflictLatest} loading={conflictLoading} loadError={conflictLoadError} draft={draft} draftName={resolvedAssetName} draftTypeName={selectedTypeDisplayName} draftBehavior={selectedType?.behavior} ledger={ledger} assets={assets} onRetry={() => void loadConflictLatest()} onApply={applyDraftToLatest} onReset={useLatestValues} /> : null}
        {rebased ? <p className="mt-6 border-l-4 border-forest-600 px-4 py-2 text-sm text-forest-800 dark:text-forest-100" role="status">최신 버전에 내 입력을 적용할 준비가 됐어요. 내용을 확인하고 변경 저장을 눌러 주세요.</p> : null}
        {saveAsset.error && !conflict ? <p className="mt-6 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{saveAsset.error instanceof Error ? saveAsset.error.message : '자산을 저장하지 못했어요.'} 입력은 그대로 두었습니다.</p> : null}
        {saved ? <p className="mt-6 border-l-4 border-forest-600 px-4 py-2 text-sm text-forest-800 dark:text-forest-100" role="status">자산 정보를 저장했어요.</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-4 sm:flex sm:justify-end">
          <Button asChild variant="secondary"><Link to="/assets">취소</Link></Button>
          <Button type="submit" disabled={saveAsset.isPending || !online || remoteDeleted || remoteArchived || conflict}>{saveAsset.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}{editing ? '변경 저장' : '자산 등록'}</Button>
        </div>
      </form>
      {initialAsset ? <AssetRemovalSection asset={initialAsset} disabled={remoteDeleted || remoteArchived || conflict || saveAsset.isPending} /> : null}
      {paymentSourceTarget ? <PaymentSourceDialog target={paymentSourceTarget} bankType={types.find((type) => type.systemCode === 'BANK')} assets={assets} ownerMemberId={ledger.members.find((member) => member.currentUser)?.memberId ?? ledger.members[0]?.memberId ?? ''} onCreated={selectCreatedPaymentSource} onRequestClose={closePaymentSourceDialog} /> : null}
    </div>
  )
}

function ArchivedAssetDetail({ asset, assets, ledger }: { asset: Asset; assets: Asset[]; ledger: LedgerBook }) {
  return (
    <div className="mx-auto mt-4 max-w-[40rem]">
      <header className="border-b border-[var(--line)] pb-4">
        <p className="text-sm font-semibold text-brass-500">보관됨</p>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-[-.025em]">{asset.name}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">과거 거래와 잔액을 확인할 수 있어요. 새 거래와 연결 계좌 선택에서는 제외됩니다.</p>
      </header>
      <dl className="grid gap-x-6 gap-y-4 border-b border-[var(--line)] py-5 text-sm min-[30rem]:grid-cols-2" aria-label="보관 자산 정보">
        <ReadOnlyAssetValue label="종류" value={asset.assetTypeName} />
        <ReadOnlyAssetValue label="소유" value={ownerLabel(asset.ownershipScope, asset.ownerMemberId, ledger)} />
        <ReadOnlyAssetValue label="잔액 기준일" value={asset.openedOn} />
        <ReadOnlyAssetValue label="보관 일시" value={asset.archivedAt ? archivedAtFormat.format(new Date(asset.archivedAt)) : '확인할 수 없음'} />
        <ReadOnlyAssetValue label="기준일 잔액" value={formatWon(asset.openingBalanceWon)} />
        <ReadOnlyAssetValue label="현재 잔액 · 순자산 포함" value={formatWon(asset.currentBalanceWon)} />
        {asset.behavior === 'CREDIT_CARD' ? <><ReadOnlyAssetValue label="이번 달 결제 예정" value={formatWon(asset.currentMonthCardPaymentDueWon)} /><ReadOnlyAssetValue label="다음 달 결제 예정" value={formatWon(asset.nextMonthCardPaymentDueWon)} /></> : null}
        {asset.memo ? <ReadOnlyAssetValue label="메모" value={asset.memo} className="min-[30rem]:col-span-2" /> : null}
      </dl>
      <ArchivedAssetSettings asset={asset} assets={assets} />
      {asset.behavior === 'CREDIT_CARD' ? <CardStatementListSection cardAsset={asset} assets={assets} /> : null}
      <p className="mt-6 border-l-4 border-forest-600 px-4 py-2 text-sm text-forest-800 dark:text-forest-100" role="status">보관 자산은 읽기 전용이에요. 복원 기능은 제공하지 않습니다.</p>
    </div>
  )
}

function ArchivedAssetSettings({ asset, assets }: { asset: Asset; assets: Asset[] }) {
  if (asset.cardSettings) return (
    <section className="border-b border-[var(--line)] py-5" aria-labelledby="archived-card-settings-title">
      <h2 id="archived-card-settings-title" className="text-lg font-semibold">카드 설정</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-4 text-sm min-[30rem]:grid-cols-2">
        <ReadOnlyAssetValue label="정산일" value={`${asset.cardSettings.statementClosingDay}일`} />
        <ReadOnlyAssetValue label="결제일" value={`${paymentMonthLabel(asset.cardSettings.paymentMonthOffset)} ${asset.cardSettings.paymentDay}일`} />
        <ReadOnlyAssetValue label="결제 계좌" value={assetNameForSetting(asset.cardSettings.settlementAssetId, assets)} />
        <ReadOnlyAssetValue label="자동 정산" value={asset.cardSettings.autoSettlementEnabled ? '사용' : '사용 안 함'} />
      </dl>
    </section>
  )
  if (asset.debitCardSettings) return <section className="border-b border-[var(--line)] py-5" aria-labelledby="archived-debit-settings-title"><h2 id="archived-debit-settings-title" className="text-lg font-semibold">체크카드 설정</h2><dl className="mt-3 text-sm"><ReadOnlyAssetValue label="결제 계좌" value={assetNameForSetting(asset.debitCardSettings.paymentAssetId, assets)} /></dl></section>
  if (asset.savingsSettings) return <section className="border-b border-[var(--line)] py-5" aria-labelledby="archived-savings-settings-title"><h2 id="archived-savings-settings-title" className="text-lg font-semibold">적금 설정</h2><dl className="mt-3 grid gap-x-6 gap-y-4 text-sm min-[30rem]:grid-cols-2"><ReadOnlyAssetValue label="자동이체 계좌" value={assetNameForSetting(asset.savingsSettings.transferAssetId, assets)} /><ReadOnlyAssetValue label="자동이체일" value={`${asset.savingsSettings.transferDay}일`} /></dl></section>
  return null
}

function ReadOnlyAssetValue({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return <div className={`min-w-0 ${className}`}><dt className="text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{value}</dd></div>
}

function AssetRemovalSection({ asset, disabled }: { asset: Asset; disabled: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }, [])

  const applied = useCallback((result: AssetRemovalResult) => {
    queryClient.removeQueries({ queryKey: assetKeys.detail(result.assetId) })
    queryClient.removeQueries({ queryKey: assetKeys.removalPreview(result.assetId) })
    queryClient.setQueryData<Asset[]>(assetKeys.list, (current) => current?.filter((item) => item.assetId !== result.assetId))
    void queryClient.invalidateQueries({ queryKey: assetKeys.all })
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all })
    navigate('/assets', { replace: true, state: { assetRemoved: { disposition: result.disposition, name: result.name } } })
  }, [navigate, queryClient])
  const navigateToBlockingAsset = useCallback((assetId: string) => navigate(`/assets/${assetId}`), [navigate])

  return (
    <section className="mt-10 border-t border-[var(--line)] pt-6" aria-labelledby="asset-removal-title">
      <h2 id="asset-removal-title" className="text-lg font-semibold">자산 정리</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">서버가 거래 이력을 확인해 완전 삭제 또는 보관 결과를 먼저 보여드려요.</p>
      <Button className="mt-3" type="button" variant="ghost" disabled={disabled || !online} onClick={(event) => { trigger.current = event.currentTarget; setOpen(true) }}><Archive size={17} />정리 결과 확인</Button>
      {open ? <AssetRemovalDialog assetId={asset.assetId} onRequestClose={close} onApplied={applied} onNavigateToAsset={navigateToBlockingAsset} /> : null}
    </section>
  )
}

function AssetRemovalDialog({ assetId, onRequestClose, onApplied, onNavigateToAsset }: { assetId: string; onRequestClose: () => void; onApplied: (result: AssetRemovalResult) => void; onNavigateToAsset: (assetId: string) => void }) {
  const online = useOnlineStatus()
  const historyMarker = useRef(crypto.randomUUID())
  const pendingResult = useRef<AssetRemovalResult | undefined>(undefined)
  const pendingAssetNavigation = useRef<string | undefined>(undefined)
  const removalPending = useRef(false)
  const [applyIssue, setApplyIssue] = useState<'PREVIEW_STALE' | 'NEW_BLOCKER' | null>(null)
  const applyIssueAlert = useRef<HTMLDivElement | null>(null)
  const preview = useQuery({
    queryKey: assetKeys.removalPreview(assetId),
    queryFn: () => assetApi.removalPreview(assetId),
    staleTime: 0,
    gcTime: 0,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const removeAsset = useMutation({
    mutationFn: (value: AssetRemovalPreview) => assetApi.remove(assetId, value.expectedVersion, value.previewToken),
    onMutate: () => { removalPending.current = true },
    onSuccess: (result) => {
      removalPending.current = false
      pendingResult.current = result
      requestClose()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 412) setApplyIssue('PREVIEW_STALE')
      else if (error instanceof ApiError && error.status === 409) setApplyIssue('NEW_BLOCKER')
    },
    onSettled: () => { removalPending.current = false },
  })

  useEffect(() => {
    if (!applyIssue) return
    requestAnimationFrame(() => applyIssueAlert.current?.focus())
  }, [applyIssue])

  useEffect(() => {
    const currentHistoryState = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {}
    if (currentHistoryState.dondokAssetRemovalDialog !== historyMarker.current) {
      window.history.pushState({ ...currentHistoryState, dondokAssetRemovalDialog: historyMarker.current }, '', window.location.href)
    }
    const handlePopState = () => {
      if (removalPending.current) {
        const currentState = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {}
        window.history.pushState({ ...currentState, dondokAssetRemovalDialog: historyMarker.current }, '', window.location.href)
        return
      }
      const result = pendingResult.current
      const nextAssetId = pendingAssetNavigation.current
      pendingResult.current = undefined
      pendingAssetNavigation.current = undefined
      onRequestClose()
      if (result) onApplied(result)
      else if (nextAssetId) onNavigateToAsset(nextAssetId)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [onApplied, onNavigateToAsset, onRequestClose])

  function requestClose() {
    if (window.history.state?.dondokAssetRemovalDialog === historyMarker.current) {
      window.history.back()
      return
    }
    const result = pendingResult.current
    const nextAssetId = pendingAssetNavigation.current
    pendingResult.current = undefined
    pendingAssetNavigation.current = undefined
    onRequestClose()
    if (result) onApplied(result)
    else if (nextAssetId) onNavigateToAsset(nextAssetId)
  }

  function navigateToAsset(event: MouseEvent<HTMLAnchorElement>, nextAssetId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    pendingAssetNavigation.current = nextAssetId
    requestClose()
  }

  async function refreshPreview() {
    const result = await preview.refetch()
    if (result.data && !result.error) {
      setApplyIssue(null)
      removeAsset.reset()
    }
  }

  const value = preview.data
  const blocked = Boolean(value?.blockingLinks.length)
  const warnings = value ? removalWarnings(value) : []
  const applyError = removeAsset.error instanceof ApiError && [409, 412].includes(removeAsset.error.status)
    ? null
    : removeAsset.error

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !removeAsset.isPending) requestClose() }}>
    <DialogContent
      className="left-1/2 top-auto bottom-[max(.5rem,env(safe-area-inset-bottom))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] w-[calc(100vw-2rem)] -translate-x-1/2 translate-y-0 md:top-1/2 md:bottom-auto md:w-[min(38rem,calc(100vw-3rem))] md:-translate-y-1/2"
      aria-labelledby="asset-removal-dialog-title"
      aria-describedby="asset-removal-dialog-description"
    >
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div><DialogTitle id="asset-removal-dialog-title">{value ? removalTitle(value.disposition) : '자산 정리 결과 확인'}</DialogTitle><DialogDescription id="asset-removal-dialog-description" className="mt-2">{value ? `‘${value.name}’ 자산의 현재 상태를 기준으로 확인합니다.` : '서버에서 자산의 거래와 연결 상태를 확인하고 있어요.'}</DialogDescription></div>
          <Button className="shrink-0" type="button" size="icon" variant="ghost" aria-label="자산 정리 닫기" disabled={removeAsset.isPending} onClick={requestClose}><X size={19} /></Button>
        </header>

        <div className="py-5">
          {preview.isPending ? <p className="inline-flex min-h-24 items-center gap-2 text-sm text-[var(--muted)]" role="status"><LoaderCircle className="animate-spin" size={18} />정리 결과를 확인하는 중…</p> : preview.isError && !value ? <div role="alert"><p>{preview.error instanceof ApiError && preview.error.status === 404 ? '이 자산을 더 이상 찾을 수 없어요.' : '자산 정리 결과를 불러오지 못했어요.'}</p><Button className="mt-3" type="button" variant="secondary" onClick={() => preview.refetch()}><RotateCcw size={17} />다시 확인</Button></div> : value ? (
            <>
              <p className="font-semibold">{removalDescription(value.disposition)}</p>
              <dl className="mt-4 grid gap-2 border-y border-[var(--line)] py-3 text-sm min-[28rem]:grid-cols-2">
                <div><dt className="text-[var(--muted)]">현재 잔액</dt><dd className="mt-1 font-semibold tabular-nums">{formatWon(value.currentBalanceWon)}</dd></div>
                <div><dt className="text-[var(--muted)]">연결된 거래 이력</dt><dd className="mt-1 font-semibold tabular-nums">{value.historyTransactionCount}건</dd></div>
              </dl>
              {warnings.length ? <ul className="mt-4 grid gap-2 text-sm" aria-label="자산 정리 주의사항">{warnings.map((warning) => <li className="border-l-4 border-amber-500 px-3 py-1" key={warning}>{warning}</li>)}</ul> : null}
              {blocked ? <section className="mt-5 border-t border-[var(--line)] pt-4" aria-labelledby="asset-removal-blocked-title"><h3 id="asset-removal-blocked-title" className="font-semibold">먼저 연결을 변경해 주세요</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">아래 자산에서 이 자산을 결제·이체 계좌로 사용 중이에요. 연결 설정을 바꾼 뒤 다시 확인해 주세요.</p><ul className="mt-3 divide-y divide-[var(--line-subtle)] border-y border-[var(--line)]">{value.blockingLinks.map((link) => <li key={`${link.kind}-${link.assetId}`}><Link className="flex min-h-11 items-center gap-2 py-2 text-sm transition-colors hover:text-forest-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)] dark:hover:text-forest-100" to={`/assets/${link.assetId}`} onClick={(event) => navigateToAsset(event, link.assetId)}><Link2 className="shrink-0 text-[var(--muted)]" size={17} /><span className="min-w-0"><strong className="block break-words">{link.assetName}</strong><span className="text-xs text-[var(--muted)]">{blockingLinkKindLabel(link.kind)} · 설정 열기</span></span></Link></li>)}</ul></section> : null}
              {applyIssue === 'PREVIEW_STALE' ? <div ref={applyIssueAlert} className="mt-5 border-l-4 border-amber-500 px-4 py-2 outline-none" role="alert" tabIndex={-1}><p className="font-semibold">정리 결과가 달라졌어요</p><p className="mt-1 text-sm leading-6">작성 중인 자산 정보는 그대로 두었습니다. 최신 내용을 확인한 뒤 다시 실행해 주세요.</p><Button className="mt-3" type="button" variant="secondary" disabled={preview.isFetching || !online} onClick={() => void refreshPreview()}>{preview.isFetching ? <LoaderCircle className="animate-spin" size={17} /> : <RotateCcw size={17} />}최신 내용 다시 확인</Button></div> : null}
              {applyIssue === 'NEW_BLOCKER' ? <div ref={applyIssueAlert} className="mt-5 border-l-4 border-amber-500 px-4 py-2 outline-none" role="alert" tabIndex={-1}><p className="font-semibold">새 연결이 생겨 자산을 정리할 수 없어요</p><p className="mt-1 text-sm leading-6">다른 자산이 이 자산을 결제·이체 계좌로 사용하기 시작했어요. 최신 연결을 확인하고 먼저 변경해 주세요.</p><Button className="mt-3" type="button" variant="secondary" disabled={preview.isFetching || !online} onClick={() => void refreshPreview()}>{preview.isFetching ? <LoaderCircle className="animate-spin" size={17} /> : <RotateCcw size={17} />}최신 연결 확인</Button></div> : null}
              {!online ? <p className="mt-5 border-l-4 border-amber-500 px-4 py-2 text-sm" role="status">오프라인 상태예요. 연결되면 정리 결과를 다시 확인하고 실행할 수 있어요.</p> : null}
              {applyError ? <p className="mt-5 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{applyError instanceof Error ? applyError.message : '자산을 정리하지 못했어요.'}</p> : null}
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-4 sm:flex sm:justify-end">
          <Button type="button" variant="secondary" disabled={removeAsset.isPending} onClick={requestClose}>취소</Button>
          {value && !blocked && !applyIssue ? <Button type="button" variant={value.disposition === 'DELETE' ? 'destructive' : 'primary'} disabled={removeAsset.isPending || preview.isFetching || !online} onClick={() => removeAsset.mutate(value)}>{removeAsset.isPending ? <LoaderCircle className="animate-spin" size={17} /> : value.disposition === 'DELETE' ? <Trash2 size={17} /> : <Archive size={17} />}{removalActionLabel(value.disposition)}</Button> : null}
        </div>
      </div>
    </DialogContent>
    </Dialog>
  )
}

function CardSettingsFields({ editing, draft, update, errors, candidates, onCreatePaymentSource }: {
  editing: boolean
  draft: AssetDraft
  update: <K extends keyof AssetDraft>(key: K, value: AssetDraft[K]) => void
  errors: FieldErrors
  candidates: Asset[]
  onCreatePaymentSource: (trigger: HTMLButtonElement) => void
}) {
  return (
    <fieldset className="mt-5 border-t border-[var(--line)] pt-4" aria-label="신용카드 설정">
      <legend className="pr-3 text-sm font-semibold">카드 설정</legend>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(10rem,.65fr)_minmax(0,1.35fr)] md:gap-5">
        <Field id="statementClosingDay" name="statementClosingDay" label="정산일" hint="1일부터 31일까지" value={draft.statementClosingDay} onChange={(event) => update('statementClosingDay', event.target.value)} type="number" min={1} max={31} inputMode="numeric" error={errors.statementClosingDay} required />
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(8rem,.65fr)]">
          <SelectField id="paymentMonthOffset" label="결제 월" value={draft.paymentMonthOffset} onChange={(value) => update('paymentMonthOffset', value)} error={errors.paymentMonthOffset} required><option value="0">같은 달</option><option value="1">다음 달</option><option value="2">다다음 달</option></SelectField>
          <Field id="paymentDay" name="paymentDay" label="결제일" hint="1일부터 31일까지" value={draft.paymentDay} onChange={(event) => update('paymentDay', event.target.value)} type="number" min={1} max={31} inputMode="numeric" error={errors.paymentDay} required />
        </div>
      </div>
      <div className="mt-4"><SelectField id="settlementAsset" label="결제 계좌" value={draft.settlementAssetId} onChange={(value) => { update('settlementAssetId', value); if (!value) update('autoSettlementEnabled', false) }} error={errors.settlementAssetId} required><option value="">결제 계좌를 선택해 주세요</option>{candidates.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {formatWon(asset.currentBalanceWon)}</option>)}</SelectField><PaymentSourceAction hasCandidates={candidates.length > 0} emptyMessage="결제 계좌가 없어 신용카드를 저장할 수 없어요. 계좌를 추가해 계속할 수 있어요." triggerLabel="신용카드 결제 계좌 만들기" onCreate={onCreatePaymentSource} /></div>
      {editing ? <label className={`mt-4 flex min-h-11 items-start gap-3 border-y border-[var(--line)] px-1 py-3 ${draft.settlementAssetId ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} htmlFor="autoSettlementEnabled">
          <Switch id="autoSettlementEnabled" className="mt-0.5" checked={draft.autoSettlementEnabled} onCheckedChange={(checked) => update('autoSettlementEnabled', checked)} disabled={!draft.settlementAssetId} />
          <span><span className="block text-sm font-semibold">결제일에 자동 정산</span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">선택한 계좌 잔액이 부족해도 전액 기록하며 음수 잔액을 허용해요.</span></span>
        </label> : null}
    </fieldset>
  )
}

function DebitCardSettingsFields({ draft, update, errors, candidates, onCreatePaymentSource }: {
  draft: AssetDraft
  update: <K extends keyof AssetDraft>(key: K, value: AssetDraft[K]) => void
  errors: FieldErrors
  candidates: Asset[]
  onCreatePaymentSource: (trigger: HTMLButtonElement) => void
}) {
  return (
    <fieldset className="mt-5 border-t border-[var(--line)] pt-4" aria-label="체크카드 설정">
      <legend className="pr-3 text-sm font-semibold">체크카드 설정</legend>
      <div className="mt-3">
        <SelectField id="debitCardPaymentAsset" label="결제 계좌" value={draft.debitCardPaymentAssetId} onChange={(value) => update('debitCardPaymentAssetId', value)} error={errors.debitCardPaymentAssetId} required>
          <option value="">결제 계좌를 선택해 주세요</option>
          {candidates.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {formatWon(asset.currentBalanceWon)}</option>)}
        </SelectField>
        <PaymentSourceAction hasCandidates={candidates.length > 0} emptyMessage="결제 계좌가 없어 체크카드를 저장할 수 없어요. 계좌를 추가해 계속할 수 있어요." triggerLabel="체크카드 결제 계좌 만들기" onCreate={onCreatePaymentSource} />
      </div>
    </fieldset>
  )
}

function SavingsSettingsFields({ draft, update, errors, candidates, onCreatePaymentSource }: {
  draft: AssetDraft
  update: <K extends keyof AssetDraft>(key: K, value: AssetDraft[K]) => void
  errors: FieldErrors
  candidates: Asset[]
  onCreatePaymentSource: (trigger: HTMLButtonElement) => void
}) {
  return (
    <fieldset className="mt-5 border-t border-[var(--line)] pt-4" aria-label="적금 설정">
      <legend className="pr-3 text-sm font-semibold">적금 설정</legend>
      <div className="mt-3 flex min-h-11 items-start gap-3 border-y border-[var(--line)] px-1 py-3">
        <Switch
          id="savingsAutoTransferEnabled"
          className="mt-0.5"
          checked={draft.savingsAutoTransferEnabled}
          aria-describedby="savings-auto-transfer-description"
          aria-controls="savings-auto-transfer-fields"
          onCheckedChange={(checked) => {
            update('savingsAutoTransferEnabled', checked)
            if (!checked) {
              update('savingsTransferAssetId', draft.savingsTransferAssetId)
              update('savingsTransferDay', draft.savingsTransferDay)
            }
          }}
        />
        <div><label className="cursor-pointer text-sm font-semibold" htmlFor="savingsAutoTransferEnabled">자동이체 설정</label><p id="savings-auto-transfer-description" className="mt-1 text-xs leading-5 text-[var(--muted)]">필요할 때만 계좌와 이체일을 함께 설정해요.</p></div>
      </div>
      {draft.savingsAutoTransferEnabled ? (
        <div id="savings-auto-transfer-fields" className="mt-4 grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(9rem,.38fr)] md:gap-5">
          <div>
            <SelectField id="savingsTransferAsset" label="자동이체 계좌" value={draft.savingsTransferAssetId} onChange={(value) => update('savingsTransferAssetId', value)} error={errors.savingsTransferAssetId} required>
              <option value="">자동이체 계좌를 선택해 주세요</option>
              {candidates.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {formatWon(asset.currentBalanceWon)}</option>)}
            </SelectField>
            <PaymentSourceAction hasCandidates={candidates.length > 0} emptyMessage="자동이체에 사용할 계좌가 없어요. 계좌를 추가해 계속할 수 있어요." triggerLabel="적금 자동이체 계좌 만들기" onCreate={onCreatePaymentSource} />
          </div>
          <Field id="savingsTransferDay" name="savingsTransferDay" label="자동이체일" hint="1일부터 31일까지" value={draft.savingsTransferDay} onChange={(event) => update('savingsTransferDay', event.target.value)} type="number" min={1} max={31} inputMode="numeric" error={errors.savingsTransferDay} required />
        </div>
      ) : null}
    </fieldset>
  )
}

function PaymentSourceAction({ hasCandidates, emptyMessage, triggerLabel, onCreate }: { hasCandidates: boolean; emptyMessage: string; triggerLabel: string; onCreate: (trigger: HTMLButtonElement) => void }) {
  return <div className="mt-2">{!hasCandidates ? <p className="text-xs leading-5 text-amber-900 dark:text-[#ffe3a3]">{emptyMessage}</p> : null}<Button className={hasCandidates ? undefined : 'mt-2'} type="button" variant="ghost" aria-label={triggerLabel} onClick={(event) => onCreate(event.currentTarget)}>계좌 추가</Button></div>
}

function PaymentSourceDialog({ target, bankType, assets, ownerMemberId, onCreated, onRequestClose }: {
  target: PaymentSourceTarget
  bankType?: AssetType
  assets: Asset[]
  ownerMemberId: string
  onCreated: (asset: Asset) => void
  onRequestClose: () => void
}) {
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const historyMarker = useRef(crypto.randomUUID())
  const idempotency = useRef<{ fingerprint: string; key: string } | undefined>(undefined)
  const [name, setName] = useState('')
  const [openingBalanceWon, setOpeningBalanceWon] = useState('')
  const [openedOn, setOpenedOn] = useState(todayInSeoul())
  const [errors, setErrors] = useState<FieldErrors>({})
  const fallbackName = resolveAssetName({ draftName: '', typeName: bankType?.name ?? '계좌', assets })

  const createAccount = useMutation({
    mutationFn: ({ input, key }: { input: CreateAssetInput; key: string }) => assetApi.create(input, key),
    onSuccess: (asset) => {
      queryClient.setQueryData<Asset[]>(assetKeys.list, (current) => appendCreatedAsset(current, asset))
      void queryClient.invalidateQueries({ queryKey: assetKeys.all })
      onCreated(asset)
      requestClose()
    },
    onError: (error, command) => {
      if (error instanceof ApiError) setErrors(fieldErrorsFromApi(error, false, command.input))
    },
  })

  useEffect(() => {
    const currentHistoryState = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {}
    if (currentHistoryState.dondokPaymentSourceDialog !== historyMarker.current) {
      window.history.pushState({ ...currentHistoryState, dondokPaymentSourceDialog: historyMarker.current }, '', window.location.href)
    }
    const handlePopState = () => onRequestClose()
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [onRequestClose])

  function requestClose() {
    if (window.history.state?.dondokPaymentSourceDialog === historyMarker.current) window.history.back()
    else onRequestClose()
  }

  function updateName(value: string) {
    setName(value)
    setErrors((current) => ({ ...current, name: undefined }))
    createAccount.reset()
  }

  function updateOpeningBalance(value: string) {
    setOpeningBalanceWon(value)
    setErrors((current) => ({ ...current, openingBalanceWon: undefined }))
    createAccount.reset()
  }

  function updateOpenedOn(value: string) {
    setOpenedOn(value)
    setErrors((current) => ({ ...current, openedOn: undefined }))
    createAccount.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || !bankType) return
    const nextErrors: FieldErrors = {}
    const normalizedAmount = openingBalanceWon.replaceAll(',', '').trim()
    const parsedAmount = normalizedAmount === '' ? 0 : Number(normalizedAmount)
    if (normalizedAmount !== '' && (!/^-?\d+$/.test(normalizedAmount) || !Number.isSafeInteger(parsedAmount))) nextErrors.openingBalanceWon = '원 단위 정수 금액을 입력해 주세요.'
    if (!openedOn) nextErrors.openedOn = '잔액 기준일을 선택해 주세요.'
    setErrors(nextErrors)
    if (hasFieldErrors(nextErrors)) return
    const input: CreateAssetInput = {
      assetTypeId: bankType.assetTypeId,
      ownershipScope: 'PERSONAL',
      ownerMemberId,
      name: resolveAssetName({ draftName: name, typeName: bankType.name, assets }),
      openedOn,
      memo: null,
      openingBalanceWon: parsedAmount,
      cardSettings: null,
      debitCardSettings: null,
      savingsSettings: null,
    }
    const fingerprint = JSON.stringify(input)
    if (!idempotency.current || idempotency.current.fingerprint !== fingerprint) idempotency.current = { fingerprint, key: crypto.randomUUID() }
    createAccount.mutate({ input, key: idempotency.current.key })
  }

  const contextDescription = target === 'savingsTransferAssetId'
    ? '적금의 자동이체에 사용할 계좌를 등록합니다. 현재 작성 중인 적금 정보는 그대로 유지돼요.'
    : '카드 결제에 사용할 계좌를 등록합니다. 현재 작성 중인 카드 정보는 그대로 유지돼요.'

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !createAccount.isPending) requestClose() }}>
    <DialogContent
      className="w-[min(36rem,calc(100vw-2rem))]"
      aria-labelledby="payment-source-dialog-title"
      aria-describedby="payment-source-dialog-description"
    >
      <div className="flex flex-col pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-5">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div><DialogTitle id="payment-source-dialog-title" className="tracking-[-.02em]">계좌 바로 만들기</DialogTitle><DialogDescription id="payment-source-dialog-description" className="mt-2">{contextDescription}</DialogDescription></div>
          <Button className="shrink-0" type="button" size="icon" variant="ghost" aria-label="계좌 만들기 닫기" disabled={createAccount.isPending} onClick={requestClose}><X size={19} /></Button>
        </header>

        <form onSubmit={submit} noValidate>
          <div className="grid gap-3 py-4 sm:gap-4 sm:py-5">
            <Field id="paymentSourceName" name="paymentSourceName" label="자산 이름 (선택)" hint={`비워 두면 ‘${fallbackName}’으로 저장해요.`} value={name} onChange={(event) => updateName(event.target.value)} maxLength={100} placeholder={fallbackName} error={errors.name} autoFocus />
            <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(13rem,.65fr)] md:gap-5">
              <MoneyField id="paymentSourceOpeningBalance" name="paymentSourceOpeningBalance" label="기준일 잔액" hint="비우면 0원, 부채는 - 금액으로 등록해요." value={openingBalanceWon} onValueChange={updateOpeningBalance} placeholder="0" error={errors.openingBalanceWon} allowNegative />
              <Field id="paymentSourceOpenedOn" name="paymentSourceOpenedOn" label="잔액 기준일" value={openedOn} onChange={(event) => updateOpenedOn(event.target.value)} type="date" error={errors.openedOn} required />
            </div>
          </div>

          {!bankType ? <p className="border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">계좌 종류 정보를 찾지 못해 지금은 등록할 수 없어요.</p> : null}
          {!online ? <p className="border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">오프라인 상태예요. 입력은 유지되며 연결 후 등록할 수 있어요.</p> : null}
          {createAccount.error ? <p className="border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{createAccount.error instanceof Error ? createAccount.error.message : '계좌를 등록하지 못했어요.'} 입력은 그대로 두었습니다.</p> : null}

          <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-4 sm:flex sm:justify-end">
            <Button type="button" variant="secondary" disabled={createAccount.isPending} onClick={requestClose}>취소</Button>
            <Button type="submit" disabled={!online || !bankType || createAccount.isPending}>{createAccount.isPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}계좌 등록</Button>
          </div>
        </form>
      </div>
    </DialogContent>
    </Dialog>
  )
}

function ConflictPanel({ latest, loading, loadError, draft, draftName, draftTypeName, draftBehavior, ledger, assets, onRetry, onApply, onReset }: {
  latest?: Asset
  loading: boolean
  loadError: boolean
  draft: AssetDraft
  draftName: string
  draftTypeName: string
  draftBehavior?: AssetBehavior
  ledger: LedgerBook
  assets: Asset[]
  onRetry: () => void
  onApply: () => void
  onReset: () => void
}) {
  const latestOwner = latest ? ownerLabel(latest.ownershipScope, latest.ownerMemberId, ledger) : ''
  const draftOwner = ownerLabel(draft.ownershipScope, draft.ownerMemberId || null, ledger)
  const latestIsCreditCard = latest?.behavior === 'CREDIT_CARD'
  const draftIsCreditCard = draftBehavior === 'CREDIT_CARD'
  const latestIsDebitCard = latest?.behavior === 'DEBIT_CARD'
  const draftIsDebitCard = draftBehavior === 'DEBIT_CARD'
  const latestIsSavings = latest?.behavior === 'SAVINGS'
  const draftIsSavings = draftBehavior === 'SAVINGS'
  const latestSettlement = assetNameForSetting(latest?.cardSettings?.settlementAssetId, assets)
  const draftSettlement = assetNameForSetting(draft.settlementAssetId, assets)
  const latestDebitPaymentAsset = assetNameForSetting(latest?.debitCardSettings?.paymentAssetId, assets)
  const draftDebitPaymentAsset = assetNameForSetting(draft.debitCardPaymentAssetId, assets)
  const latestSavingsTransferAsset = assetNameForSetting(latest?.savingsSettings?.transferAssetId, assets)
  const draftSavingsTransferAsset = assetNameForSetting(draft.savingsTransferAssetId, assets)
  const comparisonRows = latest ? [
    { id: 'name', label: '이름', latest: latest.name, draft: draftName },
    { id: 'type', label: '종류', latest: latest.assetTypeName, draft: draftTypeName },
    { id: 'owner', label: '소유', latest: latestOwner, draft: draftOwner },
    { id: 'opening-balance', label: '기준일 잔액', latest: formatWon(latest.openingBalanceWon), draft: `${draft.openingBalanceWon || '0'}원` },
    { id: 'opened-on', label: '잔액 기준일', latest: latest.openedOn, draft: draft.openedOn },
    { id: 'memo', label: '메모', latest: latest.memo || '없음', draft: draft.memo.trim() || '없음' },
    ...(latestIsCreditCard || draftIsCreditCard ? [
      { id: 'card-closing-day', label: '정산일', latest: latestIsCreditCard && latest.cardSettings ? `${latest.cardSettings.statementClosingDay}일` : '해당 없음', draft: draftIsCreditCard ? `${draft.statementClosingDay}일` : '해당 없음' },
      { id: 'card-payment-day', label: '결제일', latest: latestIsCreditCard && latest.cardSettings ? `${latest.cardSettings.paymentDay}일` : '해당 없음', draft: draftIsCreditCard ? `${draft.paymentDay}일` : '해당 없음' },
      { id: 'card-payment-month', label: '결제 월', latest: latestIsCreditCard && latest.cardSettings ? paymentMonthLabel(latest.cardSettings.paymentMonthOffset) : '해당 없음', draft: draftIsCreditCard ? paymentMonthLabel(Number(draft.paymentMonthOffset)) : '해당 없음' },
      { id: 'card-settlement-asset', label: '신용카드 결제 계좌', latest: latestIsCreditCard ? latestSettlement : '해당 없음', draft: draftIsCreditCard ? draftSettlement : '해당 없음' },
      { id: 'card-auto-settlement', label: '자동 정산', latest: latestIsCreditCard && latest.cardSettings ? (latest.cardSettings.autoSettlementEnabled ? '사용' : '사용 안 함') : '해당 없음', draft: draftIsCreditCard ? (draft.autoSettlementEnabled ? '사용' : '사용 안 함') : '해당 없음' },
    ] : []),
    ...(latestIsDebitCard || draftIsDebitCard ? [
      { id: 'debit-payment-asset', label: '체크카드 결제 계좌', latest: latestIsDebitCard ? latestDebitPaymentAsset : '해당 없음', draft: draftIsDebitCard ? draftDebitPaymentAsset : '해당 없음' },
    ] : []),
    ...(latestIsSavings || draftIsSavings ? [
      { id: 'savings-auto-transfer', label: '자동이체', latest: latestIsSavings ? (latest?.savingsSettings ? '사용' : '사용 안 함') : '해당 없음', draft: draftIsSavings ? (draft.savingsAutoTransferEnabled ? '사용' : '사용 안 함') : '해당 없음' },
      { id: 'savings-transfer-asset', label: '자동이체 계좌', latest: latestIsSavings && latest?.savingsSettings ? latestSavingsTransferAsset : '설정 안 함', draft: draftIsSavings && draft.savingsAutoTransferEnabled ? draftSavingsTransferAsset : '설정 안 함' },
      { id: 'savings-transfer-day', label: '자동이체일', latest: latestIsSavings && latest?.savingsSettings ? dayOfMonthLabel(latest.savingsSettings.transferDay) : '설정 안 함', draft: draftIsSavings && draft.savingsAutoTransferEnabled ? dayOfMonthLabel(Number(draft.savingsTransferDay)) : '설정 안 함' },
    ] : []),
  ] : []
  const changedRows = comparisonRows.filter((row) => row.latest !== row.draft)
  const visibleRows = changedRows.length ? changedRows : comparisonRows

  return (
    <section className="mt-6 border-l-4 border-amber-500 px-4 py-2 text-amber-950 dark:text-[#ffe3a3]" role="alert" aria-labelledby="asset-conflict-title">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0" size={21} /><div><h2 id="asset-conflict-title" className="font-semibold">다른 구성원이 먼저 수정했어요</h2><p className="mt-1 text-sm leading-6">내 입력은 그대로 보관했습니다. 최신값을 확인한 뒤 다시 적용하거나 최신값으로 되돌려 주세요.</p></div></div>
      {loading ? <p className="mt-4 inline-flex items-center gap-2 text-sm" role="status"><LoaderCircle className="animate-spin" size={17} />서버 최신값을 다시 확인하는 중…</p> : loadError ? <div className="mt-4"><p className="text-sm">최신값을 불러오지 못해 아직 다시 저장할 수 없어요.</p><Button className="mt-3" type="button" variant="secondary" onClick={onRetry}>최신값 다시 확인</Button></div> : latest ? <>
        <p className="mt-4 text-xs font-semibold">{changedRows.length ? `달라진 항목 ${changedRows.length}개` : '표시된 항목에서 차이를 찾지 못했어요'}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <ConflictValues title="서버 최신값" rows={visibleRows.map((row) => ({ id: row.id, label: row.label, value: row.latest }))} />
          <ConflictValues title="내 입력" rows={visibleRows.map((row) => ({ id: row.id, label: row.label, value: row.draft }))} />
        </div>
        <div className="mt-4 flex flex-col gap-2 xs:flex-row xs:justify-end"><Button type="button" variant="secondary" onClick={onReset}><RotateCcw size={17} />최신값으로 되돌리기</Button><Button type="button" onClick={onApply}>최신 버전으로 저장 준비</Button></div>
      </> : null}
    </section>
  )
}

function ConflictValues({ title, rows }: { title: string; rows: { id: string; label: string; value: string }[] }) {
  return <div className="border-t border-current/25 pt-3"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-2 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">{rows.map((row) => <div className="contents" key={row.id}><dt className="opacity-70">{row.label}</dt><dd className="break-words tabular-nums">{row.value}</dd></div>)}</dl></div>
}

function assetNameForSetting(assetId: string | null | undefined, assets: Asset[]) {
  if (!assetId) return '선택하지 않음'
  return assets.find((asset) => asset.assetId === assetId)?.name ?? '등록된 계좌'
}

function ownerLabel(scope: OwnershipScope, ownerMemberId: string | null, ledger: LedgerBook) {
  if (scope === 'JOINT') return '공동 소유'
  return ledger.members.find((member) => member.memberId === ownerMemberId)?.displayName ?? '구성원 소유'
}

function paymentMonthLabel(offset: number) {
  return offset === 0 ? '같은 달' : offset === 1 ? '다음 달' : offset === 2 ? '다다음 달' : '확인 필요'
}

function dayOfMonthLabel(day: number | undefined) {
  return day && Number.isInteger(day) ? `${day}일` : '선택하지 않음'
}

function OwnershipOption({ label, description, value, checked }: { label: string; description: string; value: AssetDraft['ownershipScope']; checked: boolean }) {
  const id = `ownership-${value.toLowerCase()}`
  return <label htmlFor={id} className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-2 px-2 py-2 text-center text-sm font-semibold transition-colors focus-within:z-10 focus-within:ring-3 focus-within:ring-[var(--ring)] ${checked ? 'bg-forest-50 text-forest-800 dark:bg-forest-950 dark:text-forest-100' : 'bg-[var(--surface)] text-[var(--muted)]'}`}><RadioGroupItem id={id} value={value} /><span>{label}<span className="sr-only">: {description}</span></span></label>
}

function newDraft(types: AssetType[], ledger: LedgerBook, preferredSystemCode: string | null): AssetDraft {
  return {
    assetTypeId: types.find((type) => type.systemCode === preferredSystemCode)?.assetTypeId ?? types[0]?.assetTypeId ?? '',
    ownershipScope: 'PERSONAL',
    ownerMemberId: ledger.members.find((member) => member.currentUser)?.memberId ?? ledger.members[0]?.memberId ?? '',
    name: '',
    openedOn: todayInSeoul(),
    memo: '',
    openingBalanceWon: '',
    statementClosingDay: '14',
    paymentDay: '25',
    paymentMonthOffset: '1',
    settlementAssetId: '',
    autoSettlementEnabled: false,
    debitCardPaymentAssetId: '',
    savingsAutoTransferEnabled: false,
    savingsTransferAssetId: '',
    savingsTransferDay: '',
    expectedVersion: 0,
    reassignTransactionsToNewOwner: false,
  }
}

function draftFromAsset(asset: Asset): AssetDraft {
  return {
    assetTypeId: asset.assetTypeId,
    ownershipScope: asset.ownershipScope,
    ownerMemberId: asset.ownerMemberId ?? '',
    name: asset.name,
    openedOn: asset.openedOn,
    memo: asset.memo ?? '',
    openingBalanceWon: String(asset.openingBalanceWon),
    statementClosingDay: String(asset.cardSettings?.statementClosingDay ?? 14),
    paymentDay: String(asset.cardSettings?.paymentDay ?? 25),
    paymentMonthOffset: String(asset.cardSettings?.paymentMonthOffset ?? 1),
    settlementAssetId: asset.cardSettings?.settlementAssetId ?? '',
    autoSettlementEnabled: asset.cardSettings?.autoSettlementEnabled ?? false,
    debitCardPaymentAssetId: asset.debitCardSettings?.paymentAssetId ?? '',
    savingsAutoTransferEnabled: Boolean(asset.savingsSettings),
    savingsTransferAssetId: asset.savingsSettings?.transferAssetId ?? '',
    savingsTransferDay: asset.savingsSettings ? String(asset.savingsSettings.transferDay) : '',
    expectedVersion: asset.version,
    reassignTransactionsToNewOwner: false,
  }
}

function parseDraft(draft: AssetDraft, selectedType: AssetType | undefined, resolvedAssetName: string, editing: boolean): { input?: CreateAssetInput; errors: FieldErrors } {
  const errors: FieldErrors = {}
  const name = resolvedAssetName
  const memo = editing ? draft.memo.trim() : ''
  const normalizedAmount = draft.openingBalanceWon.replaceAll(',', '').trim()
  const openingBalanceWon = normalizedAmount === '' ? 0 : Number(normalizedAmount)
  if (!selectedType) errors.assetTypeId = '자산 종류를 선택해 주세요.'
  if (editing && draft.ownershipScope === 'PERSONAL' && !draft.ownerMemberId) errors.ownerMemberId = '소유자를 선택해 주세요.'
  if (!draft.openedOn) errors.openedOn = '잔액 기준일을 선택해 주세요.'
  if (normalizedAmount !== '' && (!/^-?\d+$/.test(normalizedAmount) || !Number.isSafeInteger(openingBalanceWon))) errors.openingBalanceWon = '원 단위 정수 금액을 입력해 주세요.'

  let cardSettings: CardSettingsInput | null = null
  let debitCardSettings: DebitCardSettings | null = null
  let savingsSettings: SavingsSettings | null = null
  if (selectedType?.behavior === 'CREDIT_CARD') {
    const statementClosingDay = Number(draft.statementClosingDay)
    const paymentDay = Number(draft.paymentDay)
    const paymentMonthOffset = Number(draft.paymentMonthOffset)
    if (!Number.isInteger(statementClosingDay) || statementClosingDay < 1 || statementClosingDay > 31) errors.statementClosingDay = '1일부터 31일 사이로 입력해 주세요.'
    if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) errors.paymentDay = '1일부터 31일 사이로 입력해 주세요.'
    if (![0, 1, 2].includes(paymentMonthOffset)) errors.paymentMonthOffset = '결제 월을 선택해 주세요.'
    if (!draft.settlementAssetId) errors.settlementAssetId = '결제 계좌를 선택해 주세요.'
    cardSettings = { statementClosingDay, paymentDay, paymentMonthOffset, settlementAssetId: draft.settlementAssetId, autoSettlementEnabled: editing ? draft.autoSettlementEnabled : false }
  }
  if (selectedType?.behavior === 'DEBIT_CARD') {
    if (!draft.debitCardPaymentAssetId) errors.debitCardPaymentAssetId = '결제 계좌를 선택해 주세요.'
    debitCardSettings = { paymentAssetId: draft.debitCardPaymentAssetId }
  }
  if (selectedType?.behavior === 'SAVINGS' && draft.savingsAutoTransferEnabled) {
    const transferDay = Number(draft.savingsTransferDay)
    if (!draft.savingsTransferAssetId) errors.savingsTransferAssetId = '자동이체 계좌를 선택해 주세요.'
    if (!Number.isInteger(transferDay) || transferDay < 1 || transferDay > 31) errors.savingsTransferDay = '1일부터 31일 사이로 입력해 주세요.'
    savingsSettings = { transferAssetId: draft.savingsTransferAssetId, transferDay }
  }

  if (hasFieldErrors(errors)) return { errors }
  return {
    errors,
    input: {
      assetTypeId: draft.assetTypeId,
      ownershipScope: editing ? draft.ownershipScope : 'PERSONAL',
      ownerMemberId: editing && draft.ownershipScope === 'JOINT' ? null : draft.ownerMemberId,
      name,
      openedOn: draft.openedOn,
      memo: memo || null,
      openingBalanceWon,
      cardSettings,
      debitCardSettings,
      savingsSettings,
    },
  }
}

function fieldErrorsFromApi(error: ApiError, editing: boolean, input: CreateAssetInput): FieldErrors {
  const fieldNames: Partial<Record<string, keyof AssetDraft>> = {
    assetTypeId: 'assetTypeId',
    ownershipScope: 'ownershipScope',
    ownerMemberId: 'ownerMemberId',
    name: 'name',
    openedOn: 'openedOn',
    memo: 'memo',
    openingBalanceWon: 'openingBalanceWon',
    statementClosingDay: 'statementClosingDay',
    paymentDay: 'paymentDay',
    paymentMonthOffset: 'paymentMonthOffset',
    settlementAssetId: 'settlementAssetId',
    autoSettlementEnabled: 'autoSettlementEnabled',
    paymentAssetId: 'debitCardPaymentAssetId',
    savingsAutoTransferEnabled: 'savingsAutoTransferEnabled',
    transferAssetId: 'savingsTransferAssetId',
    transferDay: 'savingsTransferDay',
  }
  const result: FieldErrors = {}
  for (const [apiField, message] of Object.entries(error.errors ?? {})) {
    const rawField = apiField.split('.').at(-1) ?? apiField
    const field = fieldNames[rawField]
    if (field) result[field] = message
  }
  for (const fieldError of error.fieldErrors) {
    const rawField = fieldError.field.split('.').at(-1) ?? fieldError.field
    const field = fieldNames[rawField]
    if (field) result[field] = '입력값을 확인해 주세요.'
  }
  const visibleFields = new Set(editing ? EDIT_VISIBLE_FIELDS : CREATE_VISIBLE_FIELDS)
  if (input.cardSettings) {
    for (const field of CARD_SETTING_FIELDS) {
      if (editing || field !== 'autoSettlementEnabled') visibleFields.add(field)
    }
  }
  if (input.debitCardSettings) {
    for (const field of DEBIT_CARD_SETTING_FIELDS) visibleFields.add(field)
  }
  if (input.savingsSettings) {
    for (const field of SAVINGS_SETTING_FIELDS) visibleFields.add(field)
  }
  return Object.fromEntries(
    Object.entries(result).filter(([field]) => visibleFields.has(field as keyof AssetDraft)),
  ) as FieldErrors
}

function appendCreatedAsset(current: Asset[] | undefined, created: Asset) {
  if (!current) return [created]
  const existingIndex = current.findIndex((asset) => asset.assetId === created.assetId)
  if (existingIndex < 0) return [...current, created]
  return current.map((asset, index) => index === existingIndex ? created : asset)
}
