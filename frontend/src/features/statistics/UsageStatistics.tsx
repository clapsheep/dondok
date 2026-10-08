import type { MonthlyStatistics } from './api'
import { formatSignedWon } from './presentation'

export function UsageStatistics({ statistics }: { statistics: MonthlyStatistics }) {
  const formation = statistics.assetFormation
  const deposits = formation.savingsDepositWon + formation.investmentDepositWon
  const totalUsage = statistics.totals.expenseWon + deposits
  const summary = [
    ['수입', statistics.totals.incomeWon, 'text-[var(--income)]'],
    ['지출', -totalUsage, 'text-[var(--expense)]'],
    ['총계', statistics.totals.incomeWon - totalUsage, 'text-ink-900 dark:text-white'],
  ] as const

  return <>
    <dl className="mt-6 grid grid-cols-2 border-y border-[var(--line)] @min-[40rem]:grid-cols-3" aria-label="월간 자금 사용 요약">
      {summary.map(([label, amount, tone], index) => <div key={label} className={`min-w-0 px-1 py-4 text-right xs:px-3 ${index === 1 ? 'border-l border-[var(--line)]' : ''} ${index === 2 ? 'col-span-2 border-t border-[var(--line)] @min-[40rem]:col-span-1 @min-[40rem]:border-t-0 @min-[40rem]:border-l' : ''}`}>
        <dt className="text-sm text-[var(--muted)]">{label}</dt>
        <dd className={`mt-1 break-words text-lg font-semibold tabular-nums xs:text-xl ${tone}`}>{formatSignedWon(amount)}</dd>
      </div>)}
    </dl>
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">지출에는 생활 지출과 적금·투자 납입이 포함돼요. 회수액은 차감하지 않으며, 총계는 수입에서 지출을 뺀 금액으로 실제 계좌 잔액과 달라요.</p>
  </>
}

export function FormationDetails({ statistics }: { statistics: MonthlyStatistics }) {
  const formation = statistics.assetFormation
  return <details className="mt-8 border-y border-[var(--line)]">
    <summary className="flex min-h-11 cursor-pointer items-center py-3 font-semibold">적금·투자 납입과 회수 자세히 보기</summary>
    <p className="mt-3 text-xs text-[var(--muted)]">순납입은 납입에서 회수를 뺀 금액이며, 이자·투자 수익이나 현재 잔액은 아니에요.</p>
    <div className="grid gap-6 py-5 @min-[28rem]:grid-cols-2" aria-label="월간 적금 투자 요약">
      <FormationAmount label="적금" deposit={formation.savingsDepositWon} withdrawal={formation.savingsWithdrawalWon} />
      <FormationAmount label="투자" deposit={formation.investmentDepositWon} withdrawal={formation.investmentWithdrawalWon} />
    </div>
  </details>
}

function FormationAmount({ label, deposit, withdrawal }: { label: string; deposit: number; withdrawal: number }) {
  return <section aria-label={`${label} 납입과 회수`}>
    <h3 className="text-sm font-medium">{label}</h3>
    <p className="mt-1 text-xl font-semibold tabular-nums"><span className="mr-2 text-xs font-normal text-[var(--muted)]">순납입</span>{formatSignedWon(deposit - withdrawal)}</p>
    <dl className="mt-3 space-y-2 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--muted)]">납입</dt><dd className="ml-auto tabular-nums">{formatSignedWon(deposit)}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--muted)]">회수</dt><dd className="ml-auto tabular-nums">{formatSignedWon(withdrawal)}</dd></div>
    </dl>
  </section>
}
