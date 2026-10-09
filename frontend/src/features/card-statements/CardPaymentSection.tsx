import { ArrowLeft, ChevronDown, CreditCard } from 'lucide-react'
import { StepIndicator } from '../../components/ui/StepIndicator'
import './card-payment-layout.css'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { DatePickerField } from '../../components/ui/DatePickerField'
import { MoneyField } from '../../components/ui/MoneyField'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetApi, assetKeys, type Asset } from '../assets/api'
import { AssetPicker } from '../assets/AssetPicker'
import { formatDate, formatWon, todayInSeoul } from '../assets/format'
import type { LedgerMember } from '../membership/api'
import { transactionKeys } from '../transactions/api'
import { cardItemPaymentApi, cardPaymentItemsKey, cardStatementKeys, type CardItemPaymentInput, type CardPaymentItemPage } from './api'
import { CardStatementListSection } from './CardStatementListSection'
import { initiallySelected, selectionTotals, type BaseSelection, type SelectionOverride } from './itemSelection'

export function CardPaymentSection({ asset, members }: { asset: Asset; members: LedgerMember[] }) {
  const [step, setStep] = useState(1)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  function goToStep(next: number) { setStep(next); requestAnimationFrame(() => { stepHeading.current?.focus(); stepHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }) }) }
  const client = useQueryClient()
  const online = useOnlineStatus()
  const query = useInfiniteQuery({
    queryKey: cardPaymentItemsKey(asset.assetId), queryFn: ({ pageParam }) => cardItemPaymentApi.list(asset.assetId, pageParam),
    initialPageParam: null as string | null, getNextPageParam: (page) => page.nextCursor,
    staleTime: 0, refetchOnWindowFocus: 'always',
  })
  const assets = useQuery({ queryKey: assetKeys.list, queryFn: assetApi.list })
  const [mode, setMode] = useState<'SELECTED' | 'AMOUNT'>('SELECTED')
  const [base, setBase] = useState<BaseSelection>('CLOSED')
  const [overrides, setOverrides] = useState<Record<string, SelectionOverride>>({})
  const [snapshot, setSnapshot] = useState<CardPaymentItemPage | null>(null)
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState(asset.cardSettings?.settlementAssetId ?? '')
  const [paidOn, setPaidOn] = useState(todayInSeoul)
  const [attempt, setAttempt] = useState<{ input: CardItemPaymentInput; key: string } | null>(null)
  const [success, setSuccess] = useState<number | null>(null)
  const [params, setParams] = useSearchParams()
  const history = params.get('history') === '1'
  const current = query.data?.pages[0]
  if (!snapshot && current) setSnapshot(current)
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  const mutation = useMutation({
    mutationFn: (request: { input: CardItemPaymentInput; key: string }) => cardItemPaymentApi.pay(asset.assetId, request.input, request.key),
    onSuccess: async (result) => {
      setSuccess(result.amountWon)
      await Promise.all([
        client.invalidateQueries({ queryKey: cardStatementKeys.all }),
        client.invalidateQueries({ queryKey: assetKeys.all }),
        client.invalidateQueries({ queryKey: transactionKeys.all }),
      ])
      const latest = client.getQueryData<{ pages: CardPaymentItemPage[] }>(cardPaymentItemsKey(asset.assetId))?.pages[0]
      if (latest) setSnapshot(latest)
      setAttempt(null); setOverrides({}); setBase('CLOSED'); setAmount('')
    },
  })
  const changed = Boolean(snapshot && current && snapshot.snapshotToken !== current.snapshotToken)
    || Boolean(query.data?.pages.some((page) => current && page.snapshotToken !== current.snapshotToken))
  const conflict = mutation.error instanceof ApiError && [400, 404, 409, 412].includes(mutation.error.status)
  const locked = mutation.isPending || Boolean(attempt)
  const totals = snapshot ? selectionTotals(snapshot, base, overrides) : { amount: 0, count: 0 }
  const paymentAmount = mode === 'SELECTED' ? totals.amount : Number(amount)
  const candidates = assets.data?.filter((item) => item.status === 'ACTIVE' && item.paymentSourceCapable && item.ownerMemberId === asset.ownerMemberId) ?? []
  const valid = snapshot && Number.isSafeInteger(paymentAmount) && paymentAmount > 0 && paymentAmount <= snapshot.totals.amountWon
    && candidates.some((item) => item.assetId === account) && paidOn
  const unavailable = !online || asset.status !== 'ACTIVE'

  function chooseBase(value: BaseSelection) { setBase(value); setOverrides({}) }
  async function reload() {
    const result = await query.refetch()
    if (result.isError || !result.data) return
    const fresh = result.data.pages[0]
    const latestRows = new Map(result.data.pages.flatMap((page) => page.items).map((item) => [item.chargeId, item]))
    setOverrides((previous) => Object.fromEntries(Object.entries(previous).flatMap(([id, value]) => {
      const item = latestRows.get(id)
      return item ? [[id, { item, checked: value.checked }]] : []
    })))
    setSnapshot(fresh); setAttempt(null); mutation.reset()
  }
  function pay() {
    if (!snapshot || !valid) return
    const request = attempt ?? { key: crypto.randomUUID(), input: {
      snapshotToken: snapshot.snapshotToken, mode, baseSelection: base,
      includedChargeIds: Object.values(overrides).filter((value) => value.checked).map((value) => value.item.chargeId).sort(),
      excludedChargeIds: Object.values(overrides).filter((value) => !value.checked).map((value) => value.item.chargeId).sort(),
      amountWon: mode === 'AMOUNT' ? Number(amount) : null, settlementAssetId: account, paidOn,
    } }
    setAttempt(request); mutation.mutate(request)
  }

  const submitLabel = mutation.isPending ? '결제 기록 중…' : attempt && !conflict ? '같은 결제 다시 시도' : `${formatWon(paymentAmount || 0)} 결제 기록`
  const submitDisabled = unavailable || !valid || mutation.isPending || conflict || (changed && !attempt) || query.isError
  const closedRows = rows.filter((item) => snapshot && item.cycleEnd <= snapshot.recentClosingOn)
  const laterRows = rows.filter((item) => snapshot && item.cycleEnd > snapshot.recentClosingOn)
  function renderRows(items: typeof rows) { return <ul>{items.map((item) => {
    const checked = overrides[item.chargeId]?.checked ?? Boolean(snapshot && initiallySelected(item, base, snapshot.recentClosingOn))
    return <li key={item.chargeId} className="cp-row" data-selected={checked}>
      <label><Checkbox aria-label={`${item.description} ${item.installmentNo}/${item.installmentCount}회차 선택`} checked={checked} disabled={locked || changed || unavailable} onCheckedChange={(value) => setOverrides((previous) => ({ ...previous, [item.chargeId]: { item, checked: value } }))} />
        <span className="cp-row-title"><strong>{item.origin === 'OPENING_BALANCE' ? '기준일 미결제금' : item.description}</strong><small>{formatDate(item.occurredOn)} · {item.installmentCount > 1 ? `할부 ${item.installmentNo}/${item.installmentCount}회차` : '일시불'}<br />{formatDate(item.dueOn)} 결제 예정</small></span>
        <span className="cp-row-amount">{formatWon(item.remainingAmountWon)}</span>
      </label>
    </li>
  })}</ul> }
  return <section className="cp-page" data-step={step} aria-label="카드 대금 결제">
    <div className="cp-mobile-steps"><span>{step === 1 ? '내역 선택' : '출금 정보'}</span><StepIndicator step={step} total={2} label="결제 진행" /></div>
    <header className="cp-intro"><div><div className="cp-card"><CreditCard size={18} />{asset.name}</div><h2 ref={stepHeading} tabIndex={-1} className="text-2xl font-semibold mt-4"><span className="cp-first-title">결제할 내역을 골라주세요</span><span className="cp-second-title">어디에서 결제했나요?</span></h2><p className="cp-intro-note mt-2">카드 대금은 자산 이동으로 기록해요.</p></div><div className="cp-outstanding"><span>전체 미결제</span><strong>{current ? formatWon(current.totals.amountWon) : '—'}</strong></div></header>
    {success !== null ? <p className="ui-notice mb-4 text-sm" role="status">{formatWon(success)} 결제를 기록했어요.</p> : null}
      {(changed || conflict) && !mutation.isPending ? <div className="mt-3 text-sm" role="alert"><p>내역이 변경됐거나 결제 조건을 확인해야 해요. 입력한 계좌·날짜·금액은 유지했어요.</p><Button className="mt-2" variant="secondary" disabled={query.isFetching} onClick={reload}>최신 내역 확인</Button></div> : null}
      {mutation.error ? <p className="mt-3 text-sm" role="alert">{mutation.error.message}{!conflict ? ' 같은 결제를 다시 시도해 결과를 확인할 수 있어요.' : ''}</p> : null}
      {query.isError && current ? <p className="mt-3 text-sm" role="alert">최신 내역 조회에 실패했어요.<Button variant="ghost" onClick={reload}>다시 불러오기</Button></p> : null}
      {unavailable ? <p className="mt-3 text-sm" role="status">{asset.status !== 'ACTIVE' ? '사용 종료한 카드예요. 다시 사용한 뒤 결제할 수 있어요.' : '인터넷에 연결한 뒤 결제할 수 있어요.'}</p> : null}

    {query.isPending ? <p className="ui-empty-state" role="status">미결제 내역을 불러오는 중…</p> : query.isError && !current ? <div className="ui-empty-state" role="alert"><p>미결제 내역을 불러오지 못했어요.</p><Button variant="secondary" onClick={reload}>다시 불러오기</Button></div> : snapshot ? <div className="cp-grid" onFocusCapture={(event) => { const target = event.target as HTMLElement; if (target.closest('.cp-selection')) setStep(1); else if (target.closest('.cp-summary')) setStep(2) }}>
      <div className="cp-selection">
        <div role="tablist" aria-label="카드 결제 방식" className="ui-segmented w-full">
          {(['SELECTED', 'AMOUNT'] as const).map((value, index) => <button key={value} id={`card-pay-tab-${value}`} type="button" role="tab" aria-selected={mode === value} aria-pressed={mode === value} aria-controls={`card-pay-panel-${value}`} tabIndex={mode === value ? 0 : -1} disabled={locked} onClick={() => setMode(value)} onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'SELECTED' : event.key === 'End' ? 'AMOUNT' : index === 0 ? 'AMOUNT' : 'SELECTED'; setMode(next); document.getElementById(`card-pay-tab-${next}`)?.focus() }
          }} className="ui-segment flex-1">{value === 'SELECTED' ? '내역 선택 결제' : '부분 금액 결제'}</button>)}
        </div>
        <div id="card-pay-panel-SELECTED" role="tabpanel" aria-labelledby="card-pay-tab-SELECTED" hidden={mode !== 'SELECTED'}>
          <div className="cp-select-tools"><p>최근 정산일 {formatDate(snapshot.recentClosingOn)}까지의 미결제 내역을 기본 선택해요.</p><div><Button variant="ghost" disabled={locked || changed} onClick={() => chooseBase('CLOSED')}>정산된 내역 선택</Button><Button variant="ghost" disabled={locked || changed} onClick={() => chooseBase('ALL')}>전체 선택</Button><Button variant="ghost" disabled={locked || changed} onClick={() => chooseBase('NONE')}>선택 해제</Button></div></div>
          {closedRows.length ? <section className="cp-group"><header><h3>정산된 내역</h3><span>{closedRows.length}건</span></header>{renderRows(closedRows)}</section> : <p className="py-6 text-sm text-[var(--muted)]">정산된 미결제 내역이 없어요.</p>}
          {laterRows.length ? <details className="cp-future"><summary><span>다음 결제·미래 할부<small>{laterRows.length}건 · 이후 사용분도 직접 선택할 수 있어요.</small></span><ChevronDown size={18} /></summary>{renderRows(laterRows)}</details> : null}
          {query.hasNextPage ? <Button className="mt-2 w-full" variant="secondary" disabled={query.isFetchingNextPage || locked || changed} onClick={() => query.fetchNextPage()}>미결제 내역 더 보기</Button> : null}
          <p className="mt-4 text-sm" aria-live="polite">선택 {totals.count}건 · <strong className="tabular-nums">{formatWon(totals.amount)}</strong>{query.hasNextPage ? <span className="mt-1 block text-xs text-[var(--muted)]">아직 펼치지 않은 내역도 선택 합계에 포함돼요.</span> : null}</p>
        </div>
        <div id="card-pay-panel-AMOUNT" role="tabpanel" aria-labelledby="card-pay-tab-AMOUNT" hidden={mode !== 'AMOUNT'} className="cp-amount-panel">
          <MoneyField id="card-partial-amount" label="결제할 금액" value={amount} onValueChange={setAmount} disabled={locked || unavailable} hint={`전체 미결제 ${formatWon(snapshot.totals.amountWon)} 안에서 입력해 주세요.`} />
          <div className="cp-amount-shortcuts"><Button variant="secondary" disabled={locked || unavailable} onClick={() => setAmount(String(snapshot.totals.closedAmountWon))}>정산된 금액</Button><Button variant="secondary" disabled={locked || unavailable} onClick={() => setAmount(String(snapshot.totals.amountWon))}>미결제 전액</Button></div>
          <p className="cp-record-note">결제 예정일이 빠른 내역부터 반영해요. 같은 결제일이면 사용일이 빠른 순서로 결제하고, 남은 금액은 미결제로 유지해요.</p>
        </div>
      </div>
      <div className="cp-summary">
        <div className="cp-total"><div><span>결제할 금액</span><button className="cp-change" type="button" disabled={locked} onClick={() => goToStep(1)}>변경</button></div><p>{formatWon(paymentAmount || 0)}</p><small>{mode === 'SELECTED' ? `${totals.count}건의 선택 내역` : '입력한 금액만큼 결제'}</small></div>
        <fieldset disabled={locked || unavailable} className="cp-fields"><legend className="sr-only">출금 정보</legend>
          <AssetPicker id="card-payment-account" label="출금 계좌" assets={candidates} members={members} value={account} onChange={setAccount} disabled={locked || unavailable} required />
          <DatePickerField id="card-payment-date" label="실제 결제일" value={paidOn} onChange={setPaidOn} disabled={locked || unavailable} required />
        </fieldset>
        {assets.isError ? <p className="mt-3 text-sm" role="alert">계좌를 불러오지 못했어요.<Button variant="ghost" onClick={() => assets.refetch()}>계좌 다시 불러오기</Button></p> : !assets.isPending && !candidates.length ? <p className="mt-3 text-sm">출금 가능한 계좌를 먼저 등록해 주세요.<Link className="ml-2 underline" to="/assets/new">계좌 등록</Link></p> : null}
        <p className="cp-record-note">선택 계좌에서 카드로 이동한 금액을 기록해요. 실제 은행 이체는 별도로 진행해 주세요.</p>
        <Button className="cp-desktop-submit" disabled={submitDisabled} onClick={pay}>{submitLabel}</Button>
      </div>
      <div className="cp-mobile-footer">
        {step === 2 ? <Button variant="ghost" size="icon" aria-label="이전 결제 단계" disabled={locked} onClick={() => goToStep(1)}><ArrowLeft size={20} /></Button> : null}
        <div className="cp-footer-total"><span>결제할 금액</span><strong>{formatWon(paymentAmount || 0)}</strong></div>
        {step === 1 ? <Button disabled={!paymentAmount || paymentAmount < 0 || paymentAmount > snapshot.totals.amountWon || unavailable || changed} onClick={() => goToStep(2)}>다음</Button> : <Button disabled={submitDisabled} onClick={pay}>{mutation.isPending ? '기록 중…' : attempt && !conflict ? '다시 시도' : '결제 기록'}</Button>}
      </div>
    </div> : null}
    <Button className="mt-8" variant="ghost" aria-expanded={history} aria-controls="card-payment-history" onClick={() => setParams((current) => {
      const next = new URLSearchParams(current)
      if (history) next.delete('history'); else next.set('history', '1')
      return next
    }, { replace: true })}>결제 내역 {history ? '접기' : '보기'}<ChevronDown size={16} /></Button>
    <div id="card-payment-history">{history ? <CardStatementListSection cardAsset={asset} assets={assets.data ?? []} /> : null}</div>
  </section>
}
