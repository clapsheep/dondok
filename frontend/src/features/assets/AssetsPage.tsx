import { AssetIcon } from './AssetIcon'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CreditCard, LoaderCircle, Plus, RefreshCw, WalletCards } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { PageTitle } from '../../components/ui/PageTitle'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import type { LedgerBook } from '../membership/api'
import { assetApi, assetKeys, type Asset } from './api'
import { formatPaymentDueDate, formatWon } from './format'
import { ALL_ASSET_OWNER_VIEW, buildAssetOwnerViews, defaultAssetOwnerViewKey, filterAssetsByOwner, resolveAssetOwnerView } from './ownerView'
import { buildAssetStatusOverview, type AssetOverview } from './overview'

const ASSET_LIMIT = 50

export function AssetsPage({ ledger }: { ledger: LedgerBook }) {
  const online = useOnlineStatus()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const assets = useQuery({ queryKey: assetKeys.listByStatus('ALL'), queryFn: () => assetApi.listByStatus('ALL'), staleTime: 0, refetchOnWindowFocus: 'always' })
  const assetCount = assets.data?.filter(asset => asset.status === 'ACTIVE').length ?? 0
  const ownerViews = buildAssetOwnerViews(ledger.members)
  const defaultOwner = defaultAssetOwnerViewKey(ledger.members)
  const selectedOwner = resolveAssetOwnerView(params.get('owner'), ownerViews, defaultOwner)
  const filtered = assets.data ? filterAssetsByOwner(assets.data, selectedOwner.key) : []
  const overview = buildAssetStatusOverview(filtered)
  const groupKey = overview.active.groups.some(group => group.key === params.get('kind')) ? params.get('kind')! : 'all'
  const navigationState = location.state as { assetCreated?: boolean; createdAssetId?: string; assetRemoved?: { disposition: 'DELETED' | 'ARCHIVED'; name: string } } | null
  function selectOwner(value: string) {
    const next = new URLSearchParams(params)
    if (value === defaultOwner) next.delete('owner'); else next.set('owner', value)
    next.delete('kind')
    setParams(next, { replace: true })
  }
  function selectGroup(value: string) {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete('kind'); else next.set('kind', value)
    setParams(next, { replace: true })
  }
  const showOwner = selectedOwner.key === ALL_ASSET_OWNER_VIEW
  const cards = overview.activeAssets.filter(asset => asset.behavior === 'CREDIT_CARD')
  return <AppShell ledgerNavigation>
    <section className="ui-page @container">
      <header className="ui-page-heading"><div><PageTitle>자산 현황</PageTitle><p className="ui-subtitle">지금 가진 돈을 한눈에.</p></div><div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="최신값 확인" title="최신값 확인" onClick={() => assets.refetch()} disabled={assets.isFetching || !online}>{assets.isFetching ? <LoaderCircle className="animate-spin" size={18}/> : <RefreshCw size={18}/>}</Button>
        {assetCount >= ASSET_LIMIT || !online ? <Button aria-label="자산 추가" disabled><Plus size={17}/><span>추가</span></Button> : <Button asChild><Link to="/assets/new" aria-label="자산 추가"><Plus size={17}/><span>자산 추가</span></Link></Button>}
      </div></header>
      {navigationState?.assetCreated ? <p className="ui-notice" role="status">자산을 등록했어요.{navigationState.createdAssetId ? <> <Link className="underline" to={`/assets/${navigationState.createdAssetId}`}>거래 내역 보기</Link></> : null}</p> : null}
      {navigationState?.assetRemoved ? <p className="ui-notice" role="status">{navigationState.assetRemoved.disposition === 'DELETED' ? `‘${navigationState.assetRemoved.name}’ 자산을 완전히 삭제했어요.` : `‘${navigationState.assetRemoved.name}’ 자산의 사용을 종료했어요. 새 거래에서는 숨겨지고 필요하면 다시 사용할 수 있어요.`}</p> : null}
      {!online ? <p className="ui-notice" role="status">오프라인 상태예요. 마지막으로 불러온 자산은 볼 수 있지만 최신값 확인과 등록은 연결 후 가능해요.</p> : null}
      {assetCount >= ASSET_LIMIT ? <p className="ui-notice" role="status">활성 자산은 50개까지 등록할 수 있어요. 사용 종료한 자산은 이 개수에서 제외돼요.</p> : null}
      {assets.data?.length ? <div className="mb-6"><SegmentedControl label="소유자별 보기" value={selectedOwner.key} onChange={selectOwner} options={ownerViews.map(view => ({ value:view.key, accessibleLabel:view.key === ALL_ASSET_OWNER_VIEW ? '전체 자산 보기' : `${view.label} 자산 보기`, label:<>{view.key.startsWith('member:') ? <MemberAvatar displayName={view.label} memberId={view.key.slice(7)} size="xs"/> : null}<span>{view.label}</span></> }))}/><span className="sr-only" aria-live="polite" aria-label="표시 중인 자산 수">{selectedOwner.label} 소유 자산 {filtered.length}개</span></div> : null}
      {assets.isPending ? <div className="ui-empty" role="status"><LoaderCircle className="mx-auto animate-spin" size={28}/><p>자산을 불러오는 중…</p></div> : assets.isError && !assets.data ? <div className="ui-empty"><p role="alert">자산을 불러오지 못했어요.</p><Button variant="secondary" onClick={() => assets.refetch()}>다시 불러오기</Button></div> : assets.data?.length === 0 ? <div className="ui-empty"><WalletCards className="mx-auto" size={28}/><h2>첫 자산을 등록해 보세요</h2><p>현금, 계좌, 카드처럼 현재 함께 관리할 자산부터 시작할 수 있어요.</p><Button asChild disabled={!online}><Link to="/assets/new">자산 등록하기</Link></Button></div> : <>
        {assets.isError ? <p className="ui-notice" role="status">최신값을 확인하지 못했어요. 마지막으로 불러온 자산을 표시합니다. <Button variant="ghost" onClick={() => assets.refetch()}>다시 확인</Button></p> : null}
        <AssetFinancialSnapshot overview={overview.summary}/>
        {filtered.length ? <div className="ui-overview-layout"><div className="min-w-0">
          <div className="ui-section-heading"><h2>보유 자산 <span>{overview.activeAssets.length}</span></h2><span className="ui-caption">활성 {assetCount} / {ASSET_LIMIT}</span></div>
          <SegmentedControl className="ui-kind-filter" label="자산 종류" value={groupKey} onChange={selectGroup} options={[{value:'all',label:'전체'},...overview.active.groups.map(group=>({value:group.key,label:group.label}))]}/>
          {overview.active.groups.filter(group=>groupKey === 'all' || group.key === groupKey).map(group=><section className="ui-asset-group" key={group.key} aria-labelledby={`asset-group-${group.key}`}><header><h2 id={`asset-group-${group.key}`}>{group.label} <span>{group.items.length}개</span></h2><span aria-label="현재 합계">{formatWon(group.netWon)}</span></header><ul>{group.items.map(asset=><AssetRow key={asset.assetId} asset={asset} ledger={ledger} showOwner={showOwner}/>)}</ul></section>)}
          {!overview.activeAssets.length ? <p className="ui-empty" role="status">이 보기에는 활성 자산이 없어요.</p> : null}
          {overview.archivedAssets.length ? <details className="ui-archived"><summary>사용 종료 자산 {overview.archivedAssets.length}개</summary><p className="ui-caption">과거 거래와 잔액을 유지하며 새 거래와 연결 계좌 선택에서는 제외돼요.</p><ul>{overview.archivedAssets.map(asset=><AssetRow key={asset.assetId} asset={asset} ledger={ledger} showOwner={showOwner}/>)}</ul></details> : null}
          <p className="ui-caption mt-4">순자산과 총자산·총부채에는 사용 종료 자산도 포함돼요.</p>
        </div><aside className="min-w-0"><section className="ui-soft-panel" aria-label="카드 결제 예정"><div className="ui-section-heading"><h2>다가오는 카드 결제</h2><CreditCard size={19}/></div>
          {cards.length ? <><dl className="ui-payment-totals"><div><dt>가까운 결제 합계</dt><dd>{formatWon(overview.active.nearestCardPaymentDueWon)}</dd></div><div><dt>그다음 결제 합계</dt><dd>{formatWon(overview.active.followingCardPaymentDueWon)}</dd></div></dl>{cards.map(card=><div className="ui-card-due" key={card.assetId}><Link to={`/assets/${card.assetId}`} className="ui-card-link">{card.name}<ArrowRight size={16}/></Link>{card.nearestCardPaymentDueOn ? <><p className="ui-caption">{formatPaymentDueDate(card.nearestCardPaymentDueOn)} 결제</p><p className="ui-due-amount" data-long-money={formatWon(card.nearestCardPaymentDueWon).length > 16}>{formatWon(card.nearestCardPaymentDueWon)}</p>{card.followingCardPaymentDueOn ? <div className="ui-next-payment"><span>{formatPaymentDueDate(card.followingCardPaymentDueOn)} 결제</span><strong>{formatWon(card.followingCardPaymentDueWon)}</strong></div> : <p className="ui-caption mt-3">그다음 결제 없음</p>}</> : <p className="ui-caption">결제 예정 없음</p>}</div>)}</> : <p className="ui-caption py-8">결제 예정인 카드가 없어요.</p>}
          <p className="ui-caption mt-5">결제 예정액은 총부채와 다를 수 있어요.</p>
        </section><Link className="ui-text-link mt-5" to="/statistics">이번 달 통계 보기 <ArrowRight size={16}/></Link></aside></div> : <div className="ui-empty" role="status"><p>{selectedOwner.label} 소유로 표시된 자산이 없어요.</p><Button variant="ghost" onClick={()=>selectOwner(ALL_ASSET_OWNER_VIEW)}>전체 자산 보기</Button></div>}
      </>}
    </section>
  </AppShell>
}

function AssetFinancialSnapshot({ overview }: { overview: AssetOverview }) {
  return <section className="ui-summary" aria-label="자산 요약"><dl><dt>순자산 <span className="sr-only">· 사용 종료 자산 포함</span></dt><dd className="ui-total" data-long-money={formatWon(overview.netWon).length > 16}>{formatWon(overview.netWon)}</dd><dd className="ui-caption">자산에서 부채를 뺀 금액</dd></dl><dl className="ui-summary-details"><div><dt>총자산</dt><dd>{formatWon(overview.assetsWon)}</dd></div><div><dt>총부채</dt><dd>{formatWon(overview.liabilitiesWon)}</dd></div></dl></section>
}

function AssetRow({ asset, ledger, showOwner }: { asset: Asset; ledger: LedgerBook; showOwner: boolean }) {
  const member = ledger.members.find(item=>item.memberId === asset.ownerMemberId)
  const owner = member?.displayName ?? '구성원'
  const showType = asset.name !== asset.assetTypeName && !new RegExp(`^${asset.assetTypeName} [1-9]\\d*$`).test(asset.name)
  const value = formatWon(asset.currentBalanceWon)
  return <li><Link to={`/assets/${asset.assetId}`} className="ui-asset-row" data-long-money={value.length > 16} aria-label={`${asset.name}, ${asset.assetTypeName}, ${owner}, ${asset.status === 'ARCHIVED' ? '사용 종료, ':''}현재 잔액 ${value}`}>
    <span className="ui-asset-identity" data-asset-identity>
      <span className="ui-asset-title">
        <span className="ui-asset-icon"><AssetIcon systemCode={asset.systemCode}/></span>
        <strong data-asset-name title={asset.name}>{asset.name}</strong>
        {showType ? <span className="ui-asset-inline-type" data-asset-type><span aria-hidden="true">·</span> {asset.assetTypeName}</span> : null}
      </span>
      {showOwner || asset.status === 'ARCHIVED' ? <span className="ui-asset-metadata" data-asset-metadata>{showOwner ? <span data-asset-owner>{member?.currentUser ? '나' : owner}</span> : null}{asset.status === 'ARCHIVED' ? <span>사용 종료</span> : null}</span> : null}
    </span>
    <span className="ui-asset-money" data-money-rail="signed-balance">{value}</span>
  </Link></li>
}
