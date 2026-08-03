import type { FormEvent, Ref } from 'react'
import { Check, LoaderCircle, RotateCcw, Save } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { MoneyField } from '../../components/ui/MoneyField'
import type { CardStatementPrepaymentPreview } from './api'
import type { StatementPrepaymentWorkflow } from './prepaymentState'

type Props = {
  workflow: StatementPrepaymentWorkflow<CardStatementPrepaymentPreview>
  currentRemainingAmountWon: number
  currentPrepayableAmountWon: number
  amountError?: string
  online: boolean
  previewPending: boolean
  applyPending: boolean
  previewHeadingRef?: Ref<HTMLHeadingElement>
  onAmountChange: (value: string) => void
  onPreview: () => void
  onApply: () => void
  onRecalculateLatest: () => void
}

export function StatementPrepaymentPanel({
  workflow,
  currentRemainingAmountWon,
  currentPrepayableAmountWon,
  amountError,
  online,
  previewPending,
  applyPending,
  previewHeadingRef,
  onAmountChange,
  onPreview,
  onApply,
  onRecalculateLatest,
}: Props) {
  const busy = previewPending || applyPending
  const unavailable = currentPrepayableAmountWon <= 0

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (workflow.preview && online && !busy && !workflow.conflict && !workflow.remoteMissing) onApply()
  }

  return (
    <section className="border-t border-[var(--line)] pt-5" aria-labelledby="statement-prepayment-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="statement-prepayment-title" className="text-lg font-semibold">선결제</h2>
        <span className="text-sm text-[var(--muted)]">남은 결제 {formatWon(currentRemainingAmountWon)}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">원하는 금액만큼 먼저 결제할 수 있고, 남은 금액 안에서 여러 번 나누어 기록할 수 있어요. 수입·지출 통계에는 포함되지 않아요.</p>

      {workflow.remoteMissing ? (
        <div className="mt-4 border-l-4 border-red-600 px-4 py-2" role="alert">
          <h3 className="font-semibold">명세를 찾을 수 없어요</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">입력은 남아 있지만 더 이상 적용할 수 없어요.</p>
        </div>
      ) : null}
      {workflow.conflict ? (
        <div className="mt-4 border-l-4 border-amber-500 px-4 py-2" role="alert">
          <h3 className="font-semibold">다른 구성원이 이 명세를 먼저 결제했어요</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">입력은 그대로 두었고 이전 영향 확인은 폐기했습니다. 최신 남은 금액 {formatWon(workflow.conflict.remainingAmountWon)}을 기준으로 다시 확인해 주세요.</p>
          <Button className="mt-3" type="button" onClick={onRecalculateLatest}><RotateCcw size={17} />최신값으로 영향 다시 계산</Button>
        </div>
      ) : null}
      {!online ? <p className="mt-4 border-l-4 border-amber-500 px-4 py-2 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">인터넷 연결을 확인해 주세요. 입력은 그대로 두었고 연결되면 영향을 확인할 수 있어요.</p> : null}

      <form className="mt-5" onSubmit={submit} noValidate>
        <div className="grid gap-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto] min-[30rem]:items-end">
          <MoneyField id="statementPrepaymentAmount" label="선결제 금액" hint={`지금 최대 ${formatWon(currentPrepayableAmountWon)}`} value={workflow.draft.amountWon} onValueChange={onAmountChange} error={amountError} disabled={busy || workflow.remoteMissing} required />
          <Button
            className="w-full min-[30rem]:w-auto"
            type="button"
            size="large"
            onClick={onPreview}
            disabled={!online || busy || unavailable || workflow.remoteMissing || Boolean(workflow.conflict)}
          >
            {previewPending ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}
            결제 영향 확인
          </Button>
        </div>

        {workflow.preview ? (
          <section className="mt-6 border-y border-[var(--line)] py-5" aria-labelledby="statement-prepayment-impact-title">
            <h3 ref={previewHeadingRef} id="statement-prepayment-impact-title" className="font-semibold outline-none" tabIndex={-1}>선결제 영향</h3>
            <dl className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)] text-sm">
              <ImpactLine label="선결제 금액" value={formatWon(workflow.preview.amountWon)} />
              <ImpactLine label="적용일" value={workflow.preview.appliedOn} />
              <ImpactLine label="명세 남은 결제" value={`${formatWon(workflow.preview.currentRemainingAmountWon)} → ${formatWon(workflow.preview.afterRemainingAmountWon)}`} />
              <ImpactLine label={`${workflow.preview.settlementAsset.name} 장부`} value={`${formatSignedWon(workflow.preview.settlementAsset.currentBalanceWon)} → ${formatSignedWon(workflow.preview.afterSettlementAssetBalanceWon)}`} />
              <ImpactLine label="수입·지출 통계" value="변화 없음" />
            </dl>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">결제 계좌 잔액이 부족해도 입력한 금액 전액을 장부에 기록해요.</p>
            <Button type="submit" className="mt-5 w-full min-[30rem]:w-auto" size="large" disabled={!online || applyPending}>
              {applyPending ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}
              선결제 기록
            </Button>
          </section>
        ) : null}
      </form>
    </section>
  )
}

function ImpactLine({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 py-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]"><dt>{label}</dt><dd className="font-semibold tabular-nums min-[30rem]:text-right">{value}</dd></div>
}

function formatWon(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원`
}

function formatSignedWon(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatWon(value)}`
}
