import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Plus, RefreshCw, WalletCards } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { JointAvatar, MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { PageTitle } from '../../components/ui/PageTitle'
import { cn } from '../../lib/cn'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import type { LedgerBook } from '../membership/api'
import { assetApi, assetKeys, type Asset } from './api'
import { formatWon } from './format'
import { FinancialInstitutionAvatar } from './FinancialInstitutionPicker'
import { financialInstitution } from './financialInstitutions'
import { shouldStackMoneyRail } from './moneyRail'
import { ALL_ASSET_OWNER_VIEW, JOINT_ASSET_OWNER_VIEW, buildAssetOwnerViews, defaultAssetOwnerViewKey, filterAssetsByOwner, resolveAssetOwnerView, type AssetOwnerView } from './ownerView'
import { buildAssetStatusOverview, type AssetGroupSummary, type AssetOverview } from './overview'

const ASSET_LIMIT = 50
const infoMoneyLayoutClassName = 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3'
const cardInfoMoneyLayoutClassName = 'grid min-w-0 grid-cols-1 gap-2 xs:grid-cols-[minmax(0,1fr)_minmax(12.5rem,19rem)] xs:items-center xs:gap-4'
const moneyRailWidthClassName = 'min-w-[7.5rem] max-w-full md:min-w-[9rem]'
const cardMoneyRailWidthClassName = 'w-full min-w-0 xs:w-[19rem]'

type MoneyRailLine = {
  label: string
  shortLabel?: string
  hideLabel?: boolean
  value: string
  tone?: string
  title?: string
  valueClassName?: string
}

export function AssetsPage({ ledger }: { ledger: LedgerBook }) {
  const online = useOnlineStatus()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const assets = useQuery({
    queryKey: assetKeys.listByStatus('ALL'),
    queryFn: () => assetApi.listByStatus('ALL'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const assetCount = assets.data?.filter((asset) => asset.status === 'ACTIVE').length ?? 0
  const limitReached = assetCount >= ASSET_LIMIT
  const ownerViews = buildAssetOwnerViews(ledger.members)
  const defaultOwnerViewKey = defaultAssetOwnerViewKey(ledger.members)
  const selectedOwnerView = resolveAssetOwnerView(searchParams.get('owner'), ownerViews, defaultOwnerViewKey)
  const filteredAssets = assets.data ? filterAssetsByOwner(assets.data, selectedOwnerView.key) : undefined
  const overview = filteredAssets ? buildAssetStatusOverview(filteredAssets) : undefined
  const navigationState = location.state as { assetCreated?: boolean; createdAssetId?: string; assetRemoved?: { disposition: 'DELETED' | 'ARCHIVED'; name: string } } | null
  const assetCreated = Boolean(navigationState?.assetCreated)
  const createdAssetId = navigationState?.createdAssetId
  const selectOwnerView = (ownerViewKey: string) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    if (ownerViewKey === defaultOwnerViewKey) nextSearchParams.delete('owner')
    else nextSearchParams.set('owner', ownerViewKey)
    setSearchParams(nextSearchParams, { replace: true })
  }

  return (
    <AppShell ledgerNavigation>
      <section className="py-4 md:py-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:gap-3">
          <div className="flex min-w-0 items-baseline gap-x-2">
            <PageTitle className="whitespace-nowrap">자산 현황</PageTitle>
            <p className="whitespace-nowrap text-xs text-[var(--muted)]">활성 <strong className="font-semibold text-ink-900 dark:text-white">{assetCount}</strong> / {ASSET_LIMIT}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button className="px-3 text-xs sm:px-2" variant="ghost" aria-label="최신값 확인" title="최신값 확인" onClick={() => assets.refetch()} disabled={assets.isFetching || !online}>
              {assets.isFetching ? <LoaderCircle className="animate-spin" size={17} /> : <RefreshCw size={17} />}
              <span className="hidden sm:inline">최신값 확인</span>
            </Button>
            {limitReached
              ? <Button className="px-3 sm:px-4" aria-label="자산 추가" disabled><Plus size={18} /><span className="sm:hidden">추가</span><span className="hidden sm:inline">자산 추가</span></Button>
              : <Button className="px-3 sm:px-4" asChild><Link to="/assets/new" aria-label="자산 추가"><Plus size={18} /><span className="sm:hidden">추가</span><span className="hidden sm:inline">자산 추가</span></Link></Button>}
          </div>
        </div>

        {assetCreated ? <p className="mt-4 border-l-4 border-forest-600 px-4 py-2 text-sm text-forest-800 dark:text-forest-100" role="status">자산을 등록했어요.{createdAssetId ? <> <Link className="font-semibold underline underline-offset-4" to={`/assets/${createdAssetId}`}>거래 내역 보기</Link></> : null}</p> : null}
        {navigationState?.assetRemoved ? <p className="mt-4 border-l-4 border-forest-600 px-4 py-2 text-sm text-forest-800 dark:text-forest-100" role="status">{navigationState.assetRemoved.disposition === 'DELETED' ? `‘${navigationState.assetRemoved.name}’ 자산을 완전히 삭제했어요.` : `‘${navigationState.assetRemoved.name}’ 자산을 보관했어요. 과거 거래와 잔액은 유지돼요.`}</p> : null}
        {!online ? <p className="mt-4 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">오프라인 상태예요. 마지막으로 불러온 자산은 볼 수 있지만 최신값 확인과 등록은 연결 후 가능해요.</p> : null}
        {limitReached ? <p className="mt-4 border-l-4 border-forest-600 px-4 py-2 text-sm text-forest-800 dark:text-forest-100" role="status">활성 자산은 50개까지 등록할 수 있어요. 보관한 자산은 이 개수에서 제외돼요.</p> : null}

        {assets.data?.length ? (
          <AssetOwnerSubmenu
            ownerViews={ownerViews}
            selectedOwnerViewKey={selectedOwnerView.key}
            resultCount={filteredAssets?.length ?? 0}
            onSelect={selectOwnerView}
          />
        ) : null}

        {assets.isPending ? (
          <div className="grid min-h-64 place-items-center text-center"><div><LoaderCircle className="mx-auto animate-spin text-forest-600 dark:text-forest-100" size={34} /><p className="mt-3 text-sm text-[var(--muted)]">자산을 불러오는 중…</p></div></div>
        ) : assets.isError && !assets.data ? (
          <div className="mt-6 border-y border-[var(--line)] py-10 text-center">
            <p role="alert">자산을 불러오지 못했어요.</p>
            <Button className="mt-4" variant="secondary" onClick={() => assets.refetch()}>다시 불러오기</Button>
          </div>
        ) : assets.data?.length === 0 ? (
          <div className="mt-6 grid min-h-72 place-items-center border-y border-[var(--line)] px-6 text-center">
            <div><WalletCards className="mx-auto text-forest-700 dark:text-forest-100" size={30} /><h2 className="mt-4 text-xl font-semibold">첫 자산을 등록해 보세요</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">현금, 계좌, 카드처럼 현재 함께 관리할 자산부터 시작할 수 있어요.</p><Button asChild className="mt-5"><Link to="/assets/new"><Plus size={18} />자산 등록하기</Link></Button></div>
          </div>
        ) : overview ? (
          <AssetOverviewContent
            summaryOverview={overview.summary}
            activeOverview={overview.active}
            archivedAssets={overview.archivedAssets}
            ledger={ledger}
            showOwnerMetadata={selectedOwnerView.key === ALL_ASSET_OWNER_VIEW}
            hasFilteredAssets={Boolean(filteredAssets?.length)}
            emptyMessage={selectedOwnerView.key === JOINT_ASSET_OWNER_VIEW
              ? '공동 소유로 표시된 자산이 없어요.'
              : `${selectedOwnerView.label} 소유로 표시된 자산이 없어요.`}
            onShowAll={() => selectOwnerView(ALL_ASSET_OWNER_VIEW)}
          />
        ) : null}
      </section>
    </AppShell>
  )
}

function AssetOwnerSubmenu({ ownerViews, selectedOwnerViewKey, resultCount, onSelect }: {
  ownerViews: readonly AssetOwnerView[]
  selectedOwnerViewKey: string
  resultCount: number
  onSelect: (ownerViewKey: string) => void
}) {
  const selectedOwnerView = resolveAssetOwnerView(selectedOwnerViewKey, ownerViews)
  const resultAnnouncement = selectedOwnerView.key === ALL_ASSET_OWNER_VIEW
    ? `전체 자산 ${resultCount}개`
    : `${selectedOwnerView.label} 소유 자산 ${resultCount}개`

  return (
    <div className="-mx-4 mt-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xs:-mx-6 xs:px-6 md:mx-0 md:px-0">
      <span id="asset-owner-view-label" className="sr-only">소유자별 보기</span>
      <p id="asset-owner-view-description" className="sr-only">소유 표시는 권한과 관계없는 보기 기준입니다.</p>
      <span className="sr-only" aria-live="polite" aria-label="표시 중인 자산 수">{resultAnnouncement}</span>
      <div className="flex min-w-max items-end gap-x-1" role="group" aria-labelledby="asset-owner-view-label" aria-describedby="asset-owner-view-description">
        {ownerViews.map((ownerView) => {
          const selected = ownerView.key === selectedOwnerViewKey
          const accessibleLabel = ownerView.key === ALL_ASSET_OWNER_VIEW
            ? '전체 자산 보기'
            : `${ownerView.label} 자산 보기`
          return (
            <Button
              key={ownerView.key}
              type="button"
              variant="ghost"
              className={cn(
                'min-h-11 shrink-0 border-b-2 border-transparent px-2.5 text-sm font-medium text-[var(--muted)] transition-colors hover:text-ink-900 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)] dark:hover:text-white',
                selected && 'border-forest-700 font-semibold text-forest-800 dark:border-forest-300 dark:text-forest-100',
              )}
              aria-pressed={selected}
              aria-label={accessibleLabel}
              onClick={() => onSelect(ownerView.key)}
            >
              {ownerView.key === JOINT_ASSET_OWNER_VIEW ? <JointAvatar size="xs" /> : ownerView.key.startsWith('member:') ? <MemberAvatar displayName={ownerView.label} memberId={ownerView.key.slice('member:'.length)} size="xs" /> : null}
              <span className="block whitespace-nowrap" title={ownerView.label}>{ownerView.label}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

function AssetOverviewContent({ summaryOverview, activeOverview, archivedAssets, ledger, showOwnerMetadata, hasFilteredAssets, emptyMessage, onShowAll }: {
  summaryOverview: AssetOverview
  activeOverview: AssetOverview
  archivedAssets: Asset[]
  ledger: LedgerBook
  showOwnerMetadata: boolean
  hasFilteredAssets: boolean
  emptyMessage: string
  onShowAll: () => void
}) {
  return (
    <div className="mt-1">
      {hasFilteredAssets ? (
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start xl:gap-10">
          <div className="xl:sticky xl:top-8 xl:col-start-2 xl:row-start-1">
            <AssetFinancialSnapshot overview={summaryOverview} />
          </div>
          <div className="mt-5 min-w-0 xl:col-start-1 xl:row-start-1 xl:mt-0">
            {activeOverview.groups.length ? <div className="grid gap-6 md:gap-8">
              {activeOverview.groups.map((group) => <AssetGroup key={group.key} group={group} ledger={ledger} showOwnerMetadata={showOwnerMetadata} />)}
            </div> : <p className="border-y border-[var(--line)] py-5 text-sm text-[var(--muted)]" role="status">이 보기에는 활성 자산이 없어요.</p>}
            {archivedAssets.length ? <ArchivedAssetList assets={archivedAssets} ledger={ledger} showOwnerMetadata={showOwnerMetadata} /> : null}
          </div>
        </div>
      ) : (
        <div className="border-b border-[var(--line)] px-1 py-6" role="status">
          <p className="text-sm text-[var(--muted)]">{emptyMessage}</p>
          <Button className="mt-2 -ml-3 px-3" type="button" variant="ghost" onClick={onShowAll}>전체 자산 보기</Button>
        </div>
      )}
    </div>
  )
}

function AssetFinancialSnapshot({ overview }: { overview: AssetOverview }) {
  const debt = formatWon(overview.liabilitiesWon)
  const assets = formatWon(overview.assetsWon)
  const currentMonthPayment = formatWon(overview.currentMonthCardPaymentDueWon)
  const nextMonthPayment = formatWon(overview.nextMonthCardPaymentDueWon)
  const stacked = shouldStackMoneyRail([debt, assets, currentMonthPayment, nextMonthPayment])
  const currentMonthTone = overview.currentMonthCardPaymentDueWon > 0 ? 'text-brass-500' : 'text-[var(--muted)]'
  const nextMonthTone = overview.nextMonthCardPaymentDueWon > 0 ? 'text-brass-500' : 'text-[var(--muted)]'
  return (
    <section className="border-y border-[var(--line)] py-4 xl:border-y-0 xl:border-l xl:py-0 xl:pl-6" aria-labelledby="asset-summary-title">
      <h2 id="asset-summary-title" className="sr-only">자산 요약</h2>
      <dl>
        <dt className="text-xs font-medium text-[var(--muted)]">순자산 <span>· 보관 자산 포함</span></dt>
        <dd className={`mt-1 whitespace-nowrap text-[2rem] font-semibold leading-none tracking-[-.04em] tabular-nums md:text-4xl ${overview.netWon < 0 ? 'text-[var(--expense)]' : 'text-forest-800 dark:text-forest-100'}`} title={formatWon(overview.netWon)}>{formatWon(overview.netWon)}</dd>
      </dl>
      <div className={cn('mt-4 grid min-w-0 gap-x-3 border-t border-[var(--line-subtle)] pt-3', stacked ? 'grid-cols-1 gap-y-2' : 'grid-cols-2')}>
        <dl className="min-w-0">
          <RailLine line={{ label: '총자산', value: assets, valueClassName: 'text-base' }} />
        </dl>
        <dl className={cn('min-w-0', !stacked && 'border-l border-[var(--line-subtle)] pl-3')}>
          <RailLine line={{ label: '총부채', value: debt, tone: 'text-[var(--expense)]', valueClassName: 'text-base' }} />
        </dl>
      </div>
      <div className="mt-4 border-t border-[var(--line-subtle)] pt-3">
        <p className="text-xs font-semibold text-[var(--muted)]">카드 결제 예정</p>
        <div className={cn('mt-2 grid min-w-0 gap-x-3', stacked ? 'grid-cols-1 gap-y-2' : 'grid-cols-2')}>
          <dl className="min-w-0">
            <RailLine line={{ label: '이번 달 카드 결제 금액', shortLabel: '이번 달', value: currentMonthPayment, tone: currentMonthTone, valueClassName: 'text-base' }} />
          </dl>
          <dl className={cn('min-w-0', !stacked && 'border-l border-[var(--line-subtle)] pl-3')}>
            <RailLine line={{ label: '다음 달 카드 결제 예정 금액', shortLabel: '다음 달', value: nextMonthPayment, tone: nextMonthTone, valueClassName: 'text-base' }} />
          </dl>
        </div>
      </div>
    </section>
  )
}

function ArchivedAssetList({ assets, ledger, showOwnerMetadata }: { assets: Asset[]; ledger: LedgerBook; showOwnerMetadata: boolean }) {
  return (
    <details className="mt-6 border-y border-[var(--line)] md:mt-8">
      <summary className="flex min-h-11 cursor-pointer items-center py-3 text-sm font-semibold">보관 자산 {assets.length}개</summary>
      <p className="border-t border-[var(--line)] py-3 text-xs leading-5 text-[var(--muted)]">과거 거래와 잔액을 유지하며 새 거래와 연결 계좌 선택에서는 제외돼요.</p>
      <ul className="divide-y divide-[var(--line-subtle)] border-t border-[var(--line-subtle)]">
        {assets.map((asset) => <ArchivedAssetRow key={asset.assetId} asset={asset} ledger={ledger} showOwnerMetadata={showOwnerMetadata} />)}
      </ul>
    </details>
  )
}

function ArchivedAssetRow({ asset, ledger, showOwnerMetadata }: { asset: Asset; ledger: LedgerBook; showOwnerMetadata: boolean }) {
  const ownerMember = ledger.members.find((member) => member.memberId === asset.ownerMemberId)
  const owner = asset.ownershipScope === 'JOINT' ? '공동 소유' : ownerMember?.displayName ?? '구성원'
  const visibleOwner = asset.ownershipScope === 'JOINT' ? '공동' : ownerMember?.currentUser ? '나' : owner
  const institution = asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS' ? financialInstitution(asset.financialInstitutionCode) : undefined
  const accessibleName = `${asset.name}, ${institution ? `${institution.name}, ` : ''}${asset.assetTypeName}, ${owner}, 보관됨, 현재 잔액 ${formatWon(asset.currentBalanceWon)}`
  return (
    <li>
      <Link className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2.5 transition-colors hover:text-forest-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)] dark:hover:text-forest-100 sm:gap-3 sm:py-3" to={`/assets/${asset.assetId}`} aria-label={accessibleName}>
        <span className="flex min-w-0 items-center gap-2">{institution ? <FinancialInstitutionAvatar code={asset.financialInstitutionCode} /> : null}<span className="min-w-0"><strong className="block break-words text-sm sm:truncate">{asset.name}</strong><span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 break-words text-xs text-[var(--muted)] sm:flex-nowrap">{institution ? <><span className="sm:truncate">{institution.name}</span><span aria-hidden="true">·</span></> : null}<span className="sm:truncate">{asset.assetTypeName}</span>{showOwnerMetadata ? <><span aria-hidden="true">·</span><AssetOwnerAvatar asset={asset} ownerMember={ownerMember} /><span className="sm:truncate" data-asset-owner>{visibleOwner}</span></> : null}<span aria-hidden="true">·</span><span>보관됨</span></span></span></span>
        <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${asset.currentBalanceWon < 0 ? 'text-[var(--expense)]' : ''}`}>{formatWon(asset.currentBalanceWon)}</span>
      </Link>
    </li>
  )
}

function AssetGroup({ group, ledger, showOwnerMetadata }: { group: AssetGroupSummary; ledger: LedgerBook; showOwnerMetadata: boolean }) {
  const isLiquidGroup = group.key === 'liquid'
  const isCardGroup = group.key === 'cards'
  const hasAssetBalance = group.assetsWon > 0
  const hasLiabilityBalance = group.liabilitiesWon > 0
  const debtLines: MoneyRailLine[] = [
    ...(hasLiabilityBalance ? [{
      label: '부채',
      value: formatWon(group.liabilitiesWon),
      tone: 'text-[var(--expense)]',
    }] : []),
  ]
  const assetLines: MoneyRailLine[] = hasAssetBalance ? [{ label: '자산', value: formatWon(group.assetsWon) }] : []
  const zeroLine: MoneyRailLine | undefined = !hasAssetBalance && !hasLiabilityBalance ? { label: '잔액', value: '0원' } : undefined
  const layoutClassName = isCardGroup ? cardInfoMoneyLayoutClassName : infoMoneyLayoutClassName

  return (
    <section className="min-w-0 border-t border-[var(--line)]" aria-labelledby={`asset-group-${group.key}`}>
      <header className={`${layoutClassName} border-b border-[var(--line-subtle)] py-2.5 md:py-3`}>
        <div className="min-w-0">
          <h2 id={`asset-group-${group.key}`} className="text-sm font-semibold leading-5 text-ink-900 dark:text-white">
            {group.label}<span className="ml-1.5 text-[0.6875rem] font-normal leading-4 text-[var(--muted)]">{group.items.length}개</span>
          </h2>
        </div>
        {isLiquidGroup ? (
          <SignedBalanceRail label="현재 합계" valueWon={group.netWon} />
        ) : isCardGroup ? (
          <CardPaymentRail
            currentMonthWon={group.currentMonthCardPaymentDueWon}
            nextMonthWon={group.nextMonthCardPaymentDueWon}
            valueClassName="text-base"
          />
        ) : (
          <MoneyRail debtLines={debtLines} assetLines={assetLines} zeroLine={zeroLine} />
        )}
      </header>
      <ul className="divide-y divide-[var(--line-subtle)] border-b border-[var(--line-subtle)]">
        {group.items.map((asset) => <AssetRow key={asset.assetId} asset={asset} groupKey={group.key} ledger={ledger} showOwnerMetadata={showOwnerMetadata} />)}
      </ul>
    </section>
  )
}

function AssetRow({ asset, groupKey, ledger, showOwnerMetadata }: { asset: Asset; groupKey: AssetGroupSummary['key']; ledger: LedgerBook; showOwnerMetadata: boolean }) {
  const ownerMember = ledger.members.find((member) => member.memberId === asset.ownerMemberId)
  const owner = asset.ownershipScope === 'JOINT' ? '공동 소유' : ownerMember?.displayName ?? '구성원'
  const visibleOwner = asset.ownershipScope === 'JOINT' ? '공동' : ownerMember?.currentUser ? '나' : owner
  const showAssetType = !isDefaultAssetName(asset.name, asset.assetTypeName)
  const isLiquidAsset = groupKey === 'liquid'
  const isCardAsset = groupKey === 'cards'
  const bankRelated = asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS'
  const institution = bankRelated ? financialInstitution(asset.financialInstitutionCode) : undefined
  const isDebt = asset.currentBalanceWon < 0
  const isAsset = asset.currentBalanceWon > 0
  const debtLines: MoneyRailLine[] = [
    ...(isDebt ? [{ label: '현재 부채', value: formatWon(Math.abs(asset.currentBalanceWon)), tone: 'text-[var(--expense)]', title: `현재 잔액 ${formatWon(asset.currentBalanceWon)}`, valueClassName: 'text-base' }] : []),
  ]
  const assetLines: MoneyRailLine[] = isAsset ? [{ label: '현재 자산', value: formatWon(asset.currentBalanceWon), title: `현재 잔액 ${formatWon(asset.currentBalanceWon)}`, valueClassName: 'text-base' }] : []
  const zeroLine: MoneyRailLine | undefined = asset.currentBalanceWon === 0 ? { label: '잔액', value: '0원', title: '현재 잔액 0원', valueClassName: 'text-base' } : undefined
  const accessibleDetails = isCardAsset
    ? [
        `이번 달 결제 금액 ${formatWon(asset.currentMonthCardPaymentDueWon)}`,
        `다음 달 결제 예정 금액 ${formatWon(asset.nextMonthCardPaymentDueWon)}`,
      ]
    : isLiquidAsset
      ? [`현재 자산 ${formatWon(asset.currentBalanceWon)}`]
      : [
          ...(isDebt ? [`현재 부채 ${formatWon(Math.abs(asset.currentBalanceWon))}`] : []),
          ...(isAsset ? [`현재 자산 ${formatWon(asset.currentBalanceWon)}`] : []),
          ...(asset.currentBalanceWon === 0 ? ['잔액 0원'] : []),
        ]
  const accessibleName = `${asset.name}, ${institution ? `${institution.name}, ` : ''}${asset.assetTypeName}, ${owner}, ${accessibleDetails.join(', ')}`
  const fullIdentity = `${asset.name} · ${institution ? `${institution.name} · ` : ''}${asset.assetTypeName} · ${owner}`
  const layoutClassName = isCardAsset ? cardInfoMoneyLayoutClassName : infoMoneyLayoutClassName

  return (
    <li>
      <Link to={`/assets/${asset.assetId}`} aria-label={accessibleName} title={fullIdentity} className={`${layoutClassName} group min-h-12 py-2.5 transition-colors hover:bg-forest-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)] dark:hover:bg-forest-800 md:px-1`}>
        <span className="flex min-w-0 items-center gap-2.5 leading-5" data-asset-identity>
          {institution ? <FinancialInstitutionAvatar code={asset.financialInstitutionCode} /> : null}
          <span className="min-w-0 flex-1">
          <strong className="block min-w-0 break-words text-[0.9375rem] font-semibold leading-5 group-hover:text-forest-700 dark:group-hover:text-forest-100 md:truncate" title={asset.name} data-asset-name>{asset.name}</strong>
          {institution || showAssetType || showOwnerMetadata ? (
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-4 text-[var(--muted)] md:flex-nowrap md:truncate" data-asset-metadata>
              {institution ? <span>{institution.name}</span> : null}
              {institution && showAssetType ? <span aria-hidden="true"> · </span> : null}
              {showAssetType ? <span data-asset-type>{asset.assetTypeName}</span> : null}
              {(institution || showAssetType) && showOwnerMetadata ? <span aria-hidden="true"> · </span> : null}
              {showOwnerMetadata ? <span className="inline-flex items-center gap-1 align-middle"><AssetOwnerAvatar asset={asset} ownerMember={ownerMember} /><span data-asset-owner>{visibleOwner}</span></span> : null}
            </span>
          ) : null}
          </span>
        </span>
        {isLiquidAsset ? (
          <SignedBalanceRail
            label="현재 자산"
            valueWon={asset.currentBalanceWon}
            title={`현재 잔액 ${formatWon(asset.currentBalanceWon)}`}
            valueClassName="text-sm"
            hideLabel
          />
        ) : isCardAsset ? (
          <CardPaymentRail
            currentMonthWon={asset.currentMonthCardPaymentDueWon}
            nextMonthWon={asset.nextMonthCardPaymentDueWon}
          />
        ) : (
          <MoneyRail debtLines={debtLines} assetLines={assetLines} zeroLine={zeroLine} />
        )}
      </Link>
    </li>
  )
}

function AssetOwnerAvatar({ asset, ownerMember }: { asset: Asset; ownerMember?: LedgerBook['members'][number] }) {
  if (asset.ownershipScope === 'JOINT') return <JointAvatar size="xs" />
  return <MemberAvatar displayName={ownerMember?.displayName ?? '구성원'} memberId={ownerMember?.memberId ?? asset.ownerMemberId ?? asset.assetId} size="xs" />
}

function isDefaultAssetName(name: string, assetTypeName: string) {
  if (name === assetTypeName) return true
  if (!name.startsWith(`${assetTypeName} `)) return false
  return /^[1-9]\d*$/.test(name.slice(assetTypeName.length + 1))
}

function MoneyRail({ debtLines, assetLines, zeroLine }: {
  debtLines: MoneyRailLine[]
  assetLines: MoneyRailLine[]
  zeroLine?: MoneyRailLine
}) {
  const stacked = shouldStackMoneyRail([...debtLines, ...assetLines, ...(zeroLine ? [zeroLine] : [])].map((line) => line.value))

  return (
    <div className={cn('min-w-0', moneyRailWidthClassName)}>
      <div className={cn('grid min-w-0 gap-x-3', stacked ? 'grid-cols-1 gap-y-1.5' : 'grid-cols-2')}>
        {debtLines.length ? <MoneyRailCell className={stacked ? undefined : 'col-start-1 row-start-1'} lines={debtLines} /> : null}
        {assetLines.length ? <MoneyRailCell className={stacked ? undefined : 'col-start-2 row-start-1 border-l border-[var(--line-subtle)] pl-3'} lines={assetLines} /> : null}
        {zeroLine ? <dl className={cn('min-w-0', stacked ? 'col-span-1' : 'col-span-2 col-start-1 row-start-1')}><RailLine line={zeroLine} /></dl> : null}
      </div>
    </div>
  )
}

function SignedBalanceRail({ label, valueWon, title, valueClassName = 'text-base', hideLabel = false }: {
  label: string
  valueWon: number
  title?: string
  valueClassName?: string
  hideLabel?: boolean
}) {
  return (
    <div className={cn('min-w-0 text-right', moneyRailWidthClassName)} data-money-rail="signed-balance">
      <dl className="min-w-0">
        <RailLine line={{
          label,
          hideLabel,
          value: formatWon(valueWon),
          title,
          tone: valueWon < 0 ? 'text-[var(--expense)]' : undefined,
          valueClassName,
        }} />
      </dl>
    </div>
  )
}

function CardPaymentRail({ currentMonthWon, nextMonthWon, valueClassName = 'text-sm' }: {
  currentMonthWon: number
  nextMonthWon: number
  valueClassName?: string
}) {
  return (
    <div className={cn('grid min-w-0 grid-cols-2 gap-x-3', cardMoneyRailWidthClassName)} data-money-rail="card-payment">
      <dl className="col-start-1 min-w-0">
        <RailLine line={{
          label: '이번 달 결제 금액',
          shortLabel: '이번 달',
          value: formatWon(currentMonthWon),
          title: `이번 달 결제 금액 ${formatWon(currentMonthWon)}`,
          tone: currentMonthWon > 0 ? 'text-brass-500' : 'text-[var(--muted)]',
          valueClassName,
        }} />
      </dl>
      <dl className="col-start-2 min-w-0 border-l border-[var(--line-subtle)] pl-3">
        <RailLine line={{
          label: '다음 달 결제 예정 금액',
          shortLabel: '다음 달',
          value: formatWon(nextMonthWon),
          title: `다음 달 결제 예정 금액 ${formatWon(nextMonthWon)}`,
          tone: nextMonthWon > 0 ? 'text-brass-500' : 'text-[var(--muted)]',
          valueClassName,
        }} />
      </dl>
    </div>
  )
}

function MoneyRailCell({ lines, className }: { lines: MoneyRailLine[]; className?: string }) {
  return (
    <dl className={cn('min-w-0 space-y-1.5', className)}>
      {lines.map((line) => <RailLine key={line.label} line={line} />)}
    </dl>
  )
}

function RailLine({ line }: { line: MoneyRailLine }) {
  return (
    <div className="min-w-0 text-right">
      <dt className={line.hideLabel ? 'sr-only' : 'whitespace-nowrap text-[0.6875rem] leading-4 text-[var(--muted)]'}>
        {line.shortLabel
          ? <><span aria-hidden="true">{line.shortLabel}</span><span className="sr-only">{line.label}</span></>
          : line.label}
      </dt>
      <dd className={cn('block min-w-0 whitespace-nowrap text-sm font-semibold leading-5 tabular-nums', line.tone, line.valueClassName)} title={line.title}>{line.value}</dd>
    </div>
  )
}
