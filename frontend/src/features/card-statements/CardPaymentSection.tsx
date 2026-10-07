import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
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
  const [history, setHistory] = useState(false)
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
  const candidates = assets.data?.filter((item) => item.status === 'ACTIVE' && item.paymentSourceCapable) ?? []
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

  return <section className="mt-6 border-b border-[var(--line)] pb-5 @container" aria-labelledby="card-payment-title">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="card-payment-title" className="text-lg font-semibold">카드 대금 결제</h2><p className="text-sm">전체 미결제 <strong className="tabular-nums">{current ? formatWon(current.totals.amountWon) : '—'}</strong></p></div>
    <div role="tablist" aria-label="카드 결제 방식" className="mt-4 flex border-b border-[var(--line)]">
      {(['SELECTED', 'AMOUNT'] as const).map((value, index) => <button key={value} id={`card-pay-tab-${value}`} type="button" role="tab" aria-selected={mode === value} aria-controls={`card-pay-panel-${value}`} tabIndex={mode === value ? 0 : -1} disabled={locked} onClick={() => setMode(value)} onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const next = event.key === 'Home' ? 'SELECTED' : event.key === 'End' ? 'AMOUNT' : index === 0 ? 'AMOUNT' : 'SELECTED'
          setMode(next); document.getElementById(`card-pay-tab-${next}`)?.focus()
        }
      }} className={`min-h-11 flex-1 border-b-2 px-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--ring)] ${mode === value ? 'border-forest-700 text-forest-800 dark:text-forest-100' : 'border-transparent text-[var(--muted)]'}`}>{value === 'SELECTED' ? '내역 선택 결제' : '부분 금액 결제'}</button>)}
    </div>
    {success !== null ? <p className="mt-3 text-sm" role="status">{formatWon(success)} 결제를 기록했어요.</p> : null}
    {query.isPending ? <p className="py-6 text-sm" role="status">미결제 내역을 불러오는 중…</p> : query.isError && !current ? <div className="py-5" role="alert"><p>미결제 내역을 불러오지 못했어요.</p><Button variant="secondary" onClick={reload}>다시 불러오기</Button></div> : snapshot ? <>
      <div id="card-pay-panel-SELECTED" role="tabpanel" aria-labelledby="card-pay-tab-SELECTED" hidden={mode !== 'SELECTED'}>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">최근 정산일 {formatDate(snapshot.recentClosingOn)}까지 마감된 미결제 내역을 기본 선택해요. 이후 사용분과 미래 할부 회차도 직접 선택할 수 있어요.</p>
        <div className="mt-2 flex flex-wrap gap-1"><Button variant="ghost" disabled={locked || changed} onClick={() => chooseBase('CLOSED')}>정산된 내역 선택</Button><Button variant="ghost" disabled={locked || changed} onClick={() => chooseBase('ALL')}>전체 선택</Button><Button variant="ghost" disabled={locked || changed} onClick={() => chooseBase('NONE')}>선택 해제</Button></div>
        {rows.length ? <ul className="divide-y divide-[var(--line-subtle)]">{rows.map((item) => <li key={item.chargeId} className="flex items-center gap-3 py-3">
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Checkbox aria-label={`${item.description} ${item.installmentNo}/${item.installmentCount}회차 선택`} checked={overrides[item.chargeId]?.checked ?? initiallySelected(item, base, snapshot.recentClosingOn)} disabled={locked || changed || unavailable} onCheckedChange={(checked) => setOverrides((previous) => ({ ...previous, [item.chargeId]: { item, checked } }))} />
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{item.origin === 'OPENING_BALANCE' ? '기준일 미결제금' : item.description}</span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{formatDate(item.occurredOn)} · {item.installmentCount > 1 ? `할부 ${item.installmentNo}/${item.installmentCount}회차` : '일시불'}<br />{formatDate(item.dueOn)} 결제 예정</span></span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{formatWon(item.remainingAmountWon)}</span>
          </label>
          <Link className="shrink-0 px-1 py-3 text-xs text-[var(--muted)] underline" aria-label={`${item.description} 명세 보기`} to={`/assets/${asset.assetId}/card-statements/${item.statementId}`}>명세</Link>
        </li>)}</ul> : <p className="py-6 text-sm text-[var(--muted)]">미결제 카드 대금이 없어요.</p>}
        {query.hasNextPage ? <Button className="mt-2 w-full" variant="secondary" disabled={query.isFetchingNextPage || locked || changed} onClick={() => query.fetchNextPage()}>미결제 내역 더 보기</Button> : null}
        <p className="mt-3 text-sm" aria-live="polite">선택 {totals.count}건 · <strong className="tabular-nums">{formatWon(totals.amount)}</strong>{query.hasNextPage ? <span className="mt-1 block text-xs text-[var(--muted)]">아직 펼치지 않은 내역도 선택 합계에 포함돼요.</span> : null}</p>
      </div>
      <div id="card-pay-panel-AMOUNT" role="tabpanel" aria-labelledby="card-pay-tab-AMOUNT" hidden={mode !== 'AMOUNT'} className="py-4">
        <MoneyField id="card-partial-amount" label="결제할 금액" value={amount} onValueChange={setAmount} disabled={locked || unavailable} hint={`전체 미결제 ${formatWon(snapshot.totals.amountWon)} 안에서 입력해 주세요.`} />
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">결제 예정일이 빠른 내역부터 반영해요. 같은 결제일이면 사용일이 빠른 순서로 결제하고, 남은 금액은 미결제로 유지해요.</p>
      </div>
      <fieldset disabled={locked || unavailable} className="mt-4 grid gap-4 border-t border-[var(--line-subtle)] pt-4 @min-[32rem]:grid-cols-2">
        <legend className="sr-only">출금 정보</legend>
        <AssetPicker id="card-payment-account" label="출금 계좌" assets={candidates} members={members} value={account} onChange={setAccount} disabled={locked || unavailable} required />
        <DatePickerField id="card-payment-date" label="실제 결제일" value={paidOn} onChange={setPaidOn} disabled={locked || unavailable} required />
      </fieldset>
      {assets.isError ? <p className="mt-3 text-sm" role="alert">계좌를 불러오지 못했어요.<Button variant="ghost" onClick={() => assets.refetch()}>계좌 다시 불러오기</Button></p> : !assets.isPending && !candidates.length ? <p className="mt-3 text-sm">출금 가능한 계좌를 먼저 등록해 주세요.<Link className="ml-2 underline" to="/assets/new">계좌 등록</Link></p> : null}
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">선택 계좌에서 카드로 이동한 금액을 기록해요. 실제 은행 이체는 별도로 진행해 주세요.</p>
      {(changed || conflict) && !mutation.isPending ? <div className="mt-3 text-sm" role="alert"><p>내역이 변경됐거나 결제 조건을 확인해야 해요. 입력한 계좌·날짜·금액은 유지했어요.</p><Button className="mt-2" variant="secondary" disabled={query.isFetching} onClick={reload}>최신 내역 확인</Button></div> : null}
      {mutation.error ? <p className="mt-3 text-sm" role="alert">{mutation.error.message}{!conflict ? ' 같은 결제를 다시 시도해 결과를 확인할 수 있어요.' : ''}</p> : null}
      {query.isError && current ? <p className="mt-3 text-sm" role="alert">최신 내역 조회에 실패했어요.<Button variant="ghost" onClick={reload}>다시 불러오기</Button></p> : null}
      {unavailable ? <p className="mt-3 text-sm" role="status">{asset.status !== 'ACTIVE' ? '사용 종료한 카드예요. 다시 사용한 뒤 결제할 수 있어요.' : '인터넷에 연결한 뒤 결제할 수 있어요.'}</p> : null}
      <Button className="mt-4 w-full" disabled={unavailable || !valid || mutation.isPending || conflict || (changed && !attempt) || query.isError} onClick={pay}>{mutation.isPending ? '결제 기록 중…' : attempt && !conflict ? '같은 결제 다시 시도' : `${formatWon(paymentAmount || 0)} 결제 기록`}</Button>
    </> : null}
    <Button className="mt-4" variant="ghost" aria-expanded={history} onClick={() => setHistory((value) => !value)}>결제 이력 {history ? '접기' : '보기'}</Button>
    {history ? <CardStatementListSection cardAsset={asset} assets={assets.data ?? []} /> : null}
  </section>
}
