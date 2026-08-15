import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, Plus, RotateCcw, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { JointAvatar, MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/Dialog'
import { ApiError } from '../../lib/api'
import type { LedgerBook } from '../membership/api'
import { transactionApi, transactionKeys, type Transaction } from '../transactions/api'
import { AssetTransactionEditor } from '../transactions/TransactionFormPage'
import { transactionRowDestination, transactionTypeLabel } from '../transactions/transactionRow'
import { assetApi, assetKeys, type Asset } from './api'
import { buildAssetLedgerTimeline, type AssetLedgerEntry } from './assetLedgerTimeline'
import { formatDate, formatPaymentDueDate, formatWon } from './format'
import { FinancialInstitutionAvatar } from './FinancialInstitutionPicker'
import { financialInstitutionName, financialInstitutionUsageFor } from './financialInstitutions'
import { CardIssuerAvatar } from './CardIssuerPicker'
import { cardIssuer } from './cardIssuers'

function hasFinancialInstitution(asset: Asset) {
  return asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS' || asset.systemCode === 'LOAN' || asset.systemCode === 'INVESTMENT'
}

function isCardRelated(asset: Asset) {
  return asset.systemCode === 'CREDIT_CARD' || asset.systemCode === 'DEBIT_CARD'
}

export function AssetLedgerPage({ ledger }: { ledger: LedgerBook }) {
  const { assetId = '' } = useParams()
  const location = useLocation()
  const asset = useQuery({
    queryKey: assetKeys.detail(assetId),
    queryFn: () => assetApi.detail(assetId),
    enabled: Boolean(assetId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const transactions = useInfiniteQuery({
    queryKey: transactionKeys.assetList(assetId),
    queryFn: ({ pageParam }) => transactionApi.listForAsset({ assetId, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(assetId) && !asset.isError,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = transactions
  const items = useMemo(() => transactions.data?.pages.flatMap((page) => page.items) ?? [], [transactions.data])
  const groups = useMemo(
    () => asset.data ? buildAssetLedgerTimeline(items, asset.data, Boolean(hasNextPage)) : [],
    [asset.data, hasNextPage, items],
  )
  const loadMore = useRef<HTMLDivElement | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordDraftDirty, setRecordDraftDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [recordSaved, setRecordSaved] = useState(false)

  useEffect(() => {
    const target = loadMore.current
    if (!target || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
    }, { rootMargin: '240px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  if (asset.isPending) return <AppShell ledgerNavigation><LoadingState label="자산 거래를 준비하는 중…" /></AppShell>
  if (asset.isError || !asset.data) {
    const missing = asset.error instanceof ApiError && asset.error.status === 404
    return <AppShell ledgerNavigation><section className="mx-auto max-w-xl py-20 text-center"><h1 className="text-xl font-semibold">{missing ? '자산을 찾을 수 없어요' : '자산을 불러오지 못했어요'}</h1><p className="mt-2 text-sm text-[var(--muted)]">{missing ? '다른 구성원이 자산을 완전히 삭제했거나 주소가 올바르지 않을 수 있어요.' : '연결을 확인한 뒤 다시 시도해 주세요.'}</p>{missing ? <Button asChild className="mt-5"><Link to="/assets">자산 목록</Link></Button> : <Button className="mt-5" variant="secondary" onClick={() => asset.refetch()}>다시 불러오기</Button>}</section></AppShell>
  }

  const currentAsset = asset.data
  const brandName = hasFinancialInstitution(currentAsset)
    ? financialInstitutionName(currentAsset.financialInstitutionCode, financialInstitutionUsageFor(currentAsset.systemCode))
    : isCardRelated(currentAsset)
      ? cardIssuer(currentAsset.cardIssuerCode).name
      : undefined
  const brandAvatar = (size?: 'sm') => hasFinancialInstitution(currentAsset)
    ? <FinancialInstitutionAvatar code={currentAsset.financialInstitutionCode} size={size} />
    : isCardRelated(currentAsset)
      ? <CardIssuerAvatar code={currentAsset.cardIssuerCode} size={size} />
      : null
  const owner = ownerPresentation(currentAsset, ledger)
  const editAction = currentAsset.status === 'ACTIVE'
    ? <Button asChild size="icon" variant="ghost"><Link to={`/assets/${assetId}/edit`} aria-label="자산 편집"><Settings size={20} /></Link></Button>
    : <Button asChild size="icon" variant="ghost"><Link to={`/assets/${assetId}/edit`} aria-label="사용 종료 자산 관리"><RotateCcw size={20} /></Link></Button>
  const navigationState = location.state as { transactionDeleted?: boolean; prepaymentCancelled?: boolean; assetUpdated?: boolean; assetRestored?: boolean } | null
  const deleted = Boolean(navigationState?.transactionDeleted)
  const prepaymentCancelled = Boolean(navigationState?.prepaymentCancelled)
  const updated = Boolean(navigationState?.assetUpdated)
  const restored = Boolean(navigationState?.assetRestored)

  function openRecord() {
    setRecordSaved(false)
    setRecordDraftDirty(false)
    setRecordOpen(true)
  }

  function requestRecordClose() {
    if (recordDraftDirty) {
      setConfirmDiscard(true)
      return
    }
    setRecordOpen(false)
  }

  function discardRecord() {
    setConfirmDiscard(false)
    setRecordDraftDirty(false)
    setRecordOpen(false)
  }

  return (
    <AppShell
      ledgerNavigation
      mobileHeader={{ title: currentAsset.name, backTo: '/assets', backLabel: '자산 목록으로', action: editAction }}
    >
      <section className="mx-auto max-w-[52rem] py-4 md:py-8">
        <Button asChild className="mb-3 hidden md:inline-flex" variant="ghost"><Link to="/assets"><ArrowLeft size={17} />자산 현황으로</Link></Button>
        <header className="border-b border-[var(--line)] pb-5">
          <div className="hidden items-start justify-between gap-4 md:flex">
            <div className="flex min-w-0 items-center gap-3">{brandAvatar()}<div className="min-w-0"><p className="text-sm text-[var(--muted)]">{brandName ? `${brandName} · ` : ''}{currentAsset.assetTypeName}{currentAsset.status === 'ARCHIVED' ? ' · 사용 종료' : ''}</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-[-.025em]">{currentAsset.name}</h1></div></div>
            {editAction}
          </div>
          <div className="flex items-end justify-between gap-4 md:mt-5">
            <div className="flex min-w-0 items-center gap-2 md:hidden">{brandAvatar('sm')}<p className="text-xs text-[var(--muted)]">{brandName ? `${brandName} · ` : ''}{currentAsset.assetTypeName}{currentAsset.status === 'ARCHIVED' ? ' · 사용 종료' : ''}</p></div>
            <dl className="ml-auto text-right"><dt className="text-xs text-[var(--muted)]">현재 잔액</dt><dd className={`mt-1 text-2xl font-semibold tracking-[-.035em] tabular-nums md:text-3xl ${currentAsset.currentBalanceWon < 0 ? 'text-[var(--expense)]' : 'text-forest-800 dark:text-forest-100'}`}>{formatWon(currentAsset.currentBalanceWon)}</dd></dl>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">{owner.avatar}<span>{owner.label}</span><span aria-hidden="true">·</span><span>잔액 기준일 {formatDate(currentAsset.openedOn)}</span></div>
          {currentAsset.behavior === 'CREDIT_CARD' ? currentAsset.nearestCardPaymentDueOn ? <dl className="mt-4 grid grid-cols-2 divide-x divide-[var(--line-subtle)] border-t border-[var(--line-subtle)] pt-3 text-sm"><div className="pr-4"><dt className="text-xs text-[var(--muted)]">{formatPaymentDueDate(currentAsset.nearestCardPaymentDueOn)} 결제 예정</dt><dd className="mt-1 font-semibold tabular-nums">{formatWon(currentAsset.nearestCardPaymentDueWon)}</dd></div><div className="pl-4 text-right"><dt className="text-xs text-[var(--muted)]">{currentAsset.followingCardPaymentDueOn ? `${formatPaymentDueDate(currentAsset.followingCardPaymentDueOn)} 결제 예정` : '그다음 결제'}</dt><dd className="mt-1 font-semibold tabular-nums">{currentAsset.followingCardPaymentDueOn ? formatWon(currentAsset.followingCardPaymentDueWon) : '없음'}</dd></div></dl> : <p className="mt-4 border-t border-[var(--line-subtle)] pt-3 text-right text-xs text-[var(--muted)]">결제 예정 없음</p> : null}
        </header>

        {deleted ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">거래를 삭제했어요.</p> : null}
        {prepaymentCancelled ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">선결제를 취소하고 결제 계좌와 카드 잔액을 되돌렸어요.</p> : null}
        {updated ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">자산 정보를 변경했어요. 현재 잔액과 설정에 반영했습니다.</p> : null}
        {restored ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">자산을 다시 사용할 수 있게 복원했어요.</p> : null}
        {recordSaved ? <p className="mt-4 border-l-4 border-[var(--income)] px-3 py-2 text-sm" role="status">거래를 기록했어요. 현재 잔액과 거래 내역을 새로 반영했습니다.</p> : null}

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2"><div className="flex min-w-0 items-baseline gap-2"><h2 className="text-lg font-semibold">거래 내역</h2>{items.length ? <span className="text-xs text-[var(--muted)]">최신순</span> : null}</div>{currentAsset.status === 'ACTIVE' ? <Button type="button" onClick={openRecord}><Plus size={16} />기록 추가</Button> : null}</div>
          {transactions.isPending ? <LoadingState label="거래 내역을 불러오는 중…" /> : transactions.isError && !transactions.data ? <div className="py-12 text-center"><p role="alert">거래 내역을 불러오지 못했어요.</p><Button className="mt-4" variant="secondary" onClick={() => transactions.refetch()}>다시 불러오기</Button></div> : groups.length ? (
            <div>
              {groups.map((group) => <AssetMonthGroup key={group.month} month={group.month} items={group.items} asset={currentAsset} returnTo={`/assets/${assetId}`} />)}
              {!items.length ? <div className="border-b border-[var(--line)] py-8 text-center"><p className="font-semibold">추가로 기록된 거래가 없어요.</p><p className="mt-2 text-sm text-[var(--muted)]">기준일 잔액부터 시작해 수입·지출·이체를 이어서 확인할 수 있어요.</p>{currentAsset.status === 'ACTIVE' ? <Button className="mt-5" type="button" onClick={openRecord}><Plus size={17} />첫 기록 추가</Button> : null}</div> : null}
              {items.length ? <div ref={loadMore} className="grid min-h-16 place-items-center">
                {transactions.hasNextPage ? <Button type="button" variant="ghost" disabled={transactions.isFetchingNextPage} onClick={() => transactions.fetchNextPage()}>{transactions.isFetchingNextPage ? <><LoaderCircle className="animate-spin" size={17} />불러오는 중…</> : '이전 거래 더 보기'}</Button> : <p className="text-xs text-[var(--muted)]">모든 거래를 확인했어요.</p>}
              </div> : null}
            </div>
          ) : null}
        </div>
      </section>
      {recordOpen ? (
        <Dialog open onOpenChange={(open) => { if (!open) requestRecordClose() }}>
          <DialogContent className="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 p-0 shadow-none md:left-1/2 md:top-1/2 md:h-[min(48rem,calc(100dvh-3rem))] md:max-h-[calc(100dvh-3rem)] md:w-[min(46rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:shadow-lg" data-asset-transaction-dialog>
            <DialogHeader className="shrink-0 border-b border-[var(--line)] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 md:pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0"><DialogTitle>거래 기록</DialogTitle><DialogDescription className="mt-1"><strong className="font-semibold text-current">{currentAsset.name}</strong>을 기본 자산으로 선택했어요.</DialogDescription></div>
                <Button type="button" size="icon" variant="ghost" onClick={requestRecordClose} aria-label="거래 기록 닫기"><X size={20} /></Button>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 md:py-5">
              <AssetTransactionEditor
                ledger={ledger}
                initialAssetId={currentAsset.assetId}
                onDirtyChange={setRecordDraftDirty}
                onSaved={() => {
                  setRecordDraftDirty(false)
                  setRecordOpen(false)
                  setRecordSaved(true)
                }}
              />
            </div>
          </DialogContent>
          <Dialog open={confirmDiscard} onOpenChange={(open) => { if (!open) setConfirmDiscard(false) }}>
            <DialogContent className="p-5 sm:p-6">
              <DialogHeader><DialogTitle>작성 중인 기록을 닫을까요?</DialogTitle><DialogDescription>입력한 내용은 저장되지 않고 모두 사라져요.</DialogDescription></DialogHeader>
              <DialogFooter className="mt-6"><Button type="button" variant="secondary" onClick={() => setConfirmDiscard(false)}>계속 작성</Button><Button type="button" variant="destructive" onClick={discardRecord}>나가기</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </Dialog>
      ) : null}
    </AppShell>
  )
}

function AssetMonthGroup({ month, items, asset, returnTo }: { month: string; items: AssetLedgerEntry[]; asset: Asset; returnTo: string }) {
  return (
    <section aria-labelledby={`asset-month-${month}`}>
      <h3 id={`asset-month-${month}`} className="border-b border-[var(--line-subtle)] bg-cream-100 py-2 text-sm font-semibold tabular-nums dark:bg-[#101714]">{monthLabel(month)}</h3>
      <ul>{items.map((entry) => entry.kind === 'OPENING_BALANCE'
        ? <OpeningBalanceRow key={`opening-${entry.occurredOn}`} entry={entry} />
        : <AssetTransactionRow key={entry.transaction.transactionId} transaction={entry.transaction} balanceAfterWon={entry.balanceAfterWon} asset={asset} returnTo={returnTo} />)}</ul>
    </section>
  )
}

function OpeningBalanceRow({ entry }: { entry: Extract<AssetLedgerEntry, { kind: 'OPENING_BALANCE' }> }) {
  return (
    <li className="border-b border-[var(--line-subtle)]" data-opening-balance>
      <div className="grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 md:px-2">
        <span className="min-w-0"><strong className="block text-sm">기준일 잔액</strong><span className="mt-1 block text-xs text-[var(--muted)]"><time dateTime={entry.occurredOn}>{formatDate(entry.occurredOn)}</time> 시작 시점</span></span>
        <span className="text-right"><strong className="block text-sm font-semibold tabular-nums">{formatWon(entry.balanceAfterWon)}</strong><span className="mt-1 block text-xs text-[var(--muted)]">자산 기록 시작</span></span>
      </div>
    </li>
  )
}

function AssetTransactionRow({ transaction, balanceAfterWon, asset, returnTo }: { transaction: Transaction; balanceAfterWon: number; asset: Asset; returnTo: string }) {
  const delta = transactionDeltaForAsset(transaction, asset.assetId)
  const type = transactionTypeLabel(transaction)
  const label = transaction.description || transaction.category?.name || type
  const flow = transactionFlow(transaction, asset.assetId)
  const destination = transactionRowDestination(transaction)
  return (
    <li className="border-b border-[var(--line-subtle)]">
      <Link to={destination} state={{ returnTo }} className="grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 transition-colors hover:bg-forest-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)] dark:hover:bg-forest-800 md:px-2" aria-label={`${label} 거래 상세, ${type} ${signedWon(delta)}, 거래 후 잔액 ${formatWon(balanceAfterWon)}`}>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{label}</span><span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]"><time className="shrink-0 tabular-nums" dateTime={transaction.occurredOn}>{dayLabel(transaction.occurredOn)}</time><span aria-hidden="true">·</span><span className="shrink-0">{type}</span><span aria-hidden="true">·</span><span className="truncate">{flow}</span>{transaction.excludedFromStatistics ? <><span aria-hidden="true">·</span><span className="shrink-0 font-semibold">집계 제외</span></> : null}</span></span>
        <span className="text-right"><strong className={`block text-sm font-semibold tabular-nums ${delta < 0 ? 'text-[var(--expense)]' : delta > 0 ? 'text-[var(--income)]' : 'text-[var(--transfer)]'}`}>{signedWon(delta)}</strong><span className="mt-1 block whitespace-nowrap text-xs tabular-nums text-[var(--muted)]">잔액 {formatWon(balanceAfterWon)}</span></span>
      </Link>
    </li>
  )
}

function ownerPresentation(asset: Asset, ledger: LedgerBook) {
  if (asset.ownershipScope === 'JOINT') return { label: '공동 소유', avatar: <JointAvatar size="xs" /> }
  const member = ledger.members.find((item) => item.memberId === asset.ownerMemberId)
  const name = member?.displayName ?? '구성원'
  return { label: member?.currentUser ? '내 자산' : `${name} 소유`, avatar: <MemberAvatar displayName={name} memberId={member?.memberId ?? asset.assetId} size="xs" /> }
}

function transactionDeltaForAsset(transaction: Transaction, assetId: string) {
  const posting = transaction.postings.find((item) => item.assetId === assetId)
  if (posting) return posting.deltaWon
  if (transaction.asset?.assetId === assetId) {
    if (transaction.managementType === 'CARD_REFUND' || transaction.type === 'INCOME') return transaction.amountWon
    if (transaction.type === 'EXPENSE') return -transaction.amountWon
  }
  return 0
}

function transactionFlow(transaction: Transaction, assetId: string) {
  if (transaction.type === 'TRANSFER') {
    const source = transaction.postings.find((posting) => posting.deltaWon < 0)?.assetName
    const destination = transaction.postings.find((posting) => posting.deltaWon > 0)?.assetName
    return source && destination ? `${source} → ${destination}` : '자산 이체'
  }
  const values = [transaction.category?.name]
  if (transaction.asset && transaction.asset.assetId !== assetId) values.push(transaction.asset.name)
  if (transaction.performedBy) values.push(transaction.performedBy.displayName)
  return values.filter(Boolean).join(' · ') || '자산 반영'
}

function monthLabel(month: string) { const [year, value] = month.split('-'); return `${year}년 ${Number(value)}월` }
function dayLabel(date: string) { return new Intl.DateTimeFormat('ko-KR', { day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T00:00:00+09:00`)) }
function signedWon(value: number) { return `${value > 0 ? '+' : ''}${formatWon(value)}` }
function LoadingState({ label }: { label: string }) { return <div className="grid min-h-56 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />{label}</span></div> }
