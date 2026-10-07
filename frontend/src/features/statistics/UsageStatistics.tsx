import { Button } from '../../components/ui/Button'
import type { MonthlyStatistics, StatisticsCategoryAmount } from './api'
import { formatSignedWon } from './presentation'

export function UsageStatistics({ statistics, formationOnly, onSelectCategory }: {
  statistics: MonthlyStatistics
  formationOnly: boolean
  onSelectCategory: (category: StatisticsCategoryAmount, trigger: HTMLButtonElement) => void
}) {
  const formation = statistics.assetFormation
  const deposits = formation.savingsDepositWon + formation.investmentDepositWon
  const withdrawals = formation.savingsWithdrawalWon + formation.investmentWithdrawalWon
  const totalUsage = statistics.totals.expenseWon + deposits
  const empty = deposits === 0 && withdrawals === 0 && (formationOnly || (statistics.totals.incomeWon === 0 && statistics.categoryBreakdown.length === 0))
  const summary = formationOnly
    ? [['납입', deposits], ['회수', withdrawals], ['순납입', deposits - withdrawals]] as const
    : [['수입', statistics.totals.incomeWon], ['총 사용액', totalUsage], ['수입에서 사용하고 남은 금액', statistics.totals.incomeWon - totalUsage]] as const
  const annual = statistics.yearlyTrend.map((item) => ({
    ...item,
    deposits: item.assetFormation.savingsDepositWon + item.assetFormation.investmentDepositWon,
    withdrawals: item.assetFormation.savingsWithdrawalWon + item.assetFormation.investmentWithdrawalWon,
  }))
  const maxAmount = Math.max(1, ...annual.flatMap((item) => formationOnly
    ? [item.deposits, item.withdrawals]
    : [Math.abs(item.expenseWon), item.assetFormation.savingsDepositWon, item.assetFormation.investmentDepositWon]))
  return <>
    <dl className="mt-6 grid gap-x-6 border-y border-[var(--line)] sm:grid-cols-3" aria-label={formationOnly ? '월간 적금 투자 요약' : '월간 자금 사용 요약'}>
      {summary.map(([label, amount]) => <div key={label} className="min-w-0 py-4 text-right"><dt className="text-sm text-[var(--muted)]">{label}</dt><dd className="mt-1 break-all text-xl font-semibold tabular-nums">{formatSignedWon(amount)}</dd></div>)}
    </dl>
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{formationOnly ? '순납입은 납입에서 회수를 뺀 금액이에요. 이자·투자 수익이나 현재 잔액과는 달라요.' : '총 사용액은 소비와 적금·투자 납입의 합계이며 회수액을 차감하지 않아요. 남은 금액은 실제 계좌 잔액이 아니에요.'}</p>
    {empty ? <p className="mt-5 py-4 text-center text-sm text-[var(--muted)]" role="status">{statistics.appliedFilters.categoryId ? '선택한 분류에 맞는 기록이 없습니다. 수입·지출 분류 필터에서는 이체가 제외돼요.' : formationOnly ? '이번 달 적금·투자 기록이 없습니다' : '이번 달 수입·소비·적금·투자 기록이 없습니다'}</p> : null}
    <div className="mt-8 grid min-w-0 gap-10 @min-[54rem]:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
      <section aria-labelledby="usage-breakdown-title">
        <h2 id="usage-breakdown-title" className="border-b border-[var(--line)] pb-3 text-xl font-semibold">{formationOnly ? '적금·투자 내역' : '사용 내역'}</h2>
        {!formationOnly ? <>
          <AmountRow label="소비 지출" amount={statistics.totals.expenseWon} />
          <ul aria-label="소비 분류 내역" className="divide-y divide-[var(--line-subtle)]">
            {statistics.categoryBreakdown.filter((category) => category.kind === 'EXPENSE').map((category) => <li key={category.categoryId}>
              <Button className="flex min-h-11 w-full justify-between gap-3 text-left" variant="ghost" aria-label={`${category.categoryName} 거래 내역 보기`} onClick={(event) => onSelectCategory(category, event.currentTarget)}><span className="min-w-0 break-words">{category.categoryName}</span><span className="shrink-0 tabular-nums">{formatSignedWon(category.amountWon)}</span></Button>
            </li>)}
          </ul>
        </> : null}
        <AmountRow label="적금 납입" amount={formation.savingsDepositWon} />
        {formationOnly ? <><AmountRow label="적금 회수" amount={formation.savingsWithdrawalWon} /><AmountRow label="적금 순납입" amount={formation.savingsDepositWon - formation.savingsWithdrawalWon} /></> : null}
        <AmountRow label="투자 납입" amount={formation.investmentDepositWon} />
        {formationOnly ? <><AmountRow label="투자 회수" amount={formation.investmentWithdrawalWon} /><AmountRow label="투자 순납입" amount={formation.investmentDepositWon - formation.investmentWithdrawalWon} /></> : null}
      </section>
      <section aria-labelledby="usage-year-title" className="min-w-0">
        <h2 id="usage-year-title" className="border-b border-[var(--line)] pb-3 text-xl font-semibold">{statistics.month.slice(0, 4)}년 {formationOnly ? '납입·회수' : '자금 사용'} 흐름</h2>
        <p className="mt-3 text-xs text-[var(--muted)]">{formationOnly ? '녹색 납입 · 황동색 회수' : '적갈색 소비 · 녹색 적금 납입 · 황동색 투자 납입'}</p>
        <div className="mt-4 grid h-32 grid-cols-12 gap-1" role="img" aria-label={`연간 ${formationOnly ? '납입과 회수' : '소비와 적금 투자 납입'} 막대 차트. 정확한 금액은 아래 월별 목록에서 확인할 수 있어요.`}>
          {annual.map((item) => <div key={item.month} className="flex h-full min-w-0 flex-col">
            <div className="flex min-h-0 flex-1 items-end justify-center gap-px" aria-hidden="true">
              {(formationOnly ? [item.deposits, item.withdrawals] : [item.expenseWon, item.assetFormation.savingsDepositWon, item.assetFormation.investmentDepositWon]).map((value, index) => <span key={index} className="block w-2 max-w-[30%]" style={{ height: `${Math.abs(value) / maxAmount * 100}%`, background: formationOnly ? ['var(--income)', '#a68b52'][index] : ['var(--expense)', 'var(--income)', '#a68b52'][index], opacity: value < 0 ? 0.45 : 1 }} />)}
            </div>
            <span className="mt-2 text-center text-[10px] tabular-nums">{Number(item.month.slice(5))}월</span>
          </div>)}
        </div>
        {!formationOnly && annual.some((item) => item.expenseWon < 0) ? <p className="mt-2 text-xs text-[var(--muted)]">환불로 소비가 음수인 달은 옅은 막대로 표시하며 부호는 월별 금액에 표시해요.</p> : null}
        <ol className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]" aria-label={formationOnly ? '월별 적금 투자 금액' : '월별 자금 사용 금액'}>
          {annual.map((item) => <li key={item.month} className="py-3" aria-current={item.month === statistics.month ? 'date' : undefined}>
            <time dateTime={item.month} className={`text-sm ${item.month === statistics.month ? 'font-bold text-[var(--income)]' : 'font-medium'}`}>{Number(item.month.slice(5))}월</time>
            {formationOnly ? <>
              <AnnualRow label="적금 납입 / 회수" first={item.assetFormation.savingsDepositWon} second={item.assetFormation.savingsWithdrawalWon} />
              <AnnualRow label="투자 납입 / 회수" first={item.assetFormation.investmentDepositWon} second={item.assetFormation.investmentWithdrawalWon} />
              <AnnualRow label="순납입" first={item.deposits - item.withdrawals} />
            </> : <>
              <AnnualRow label="소비" first={item.expenseWon} />
              <AnnualRow label="적금 납입 / 투자 납입" first={item.assetFormation.savingsDepositWon} second={item.assetFormation.investmentDepositWon} />
              <AnnualRow label="총 사용액" first={item.expenseWon + item.deposits} />
            </>}
          </li>)}
        </ol>
      </section>
    </div>
  </>
}

function AmountRow({ label, amount }: { label: string; amount: number }) {
  return <dl className="flex flex-wrap justify-between gap-2 border-b border-[var(--line)] py-4 text-sm"><dt>{label}</dt><dd className="ml-auto break-all text-right font-semibold tabular-nums">{formatSignedWon(amount)}</dd></dl>
}

function AnnualRow({ label, first, second }: { label: string; first: number; second?: number }) {
  return <dl className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><dt className="text-[var(--muted)]">{label}</dt><dd className="ml-auto break-all text-right tabular-nums">{formatSignedWon(first)}{second !== undefined ? ` / ${formatSignedWon(second)}` : ''}</dd></dl>
}
