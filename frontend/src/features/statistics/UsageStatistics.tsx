import { Sprout } from 'lucide-react'
import type { MonthlyStatistics } from './api'
import { formatSignedWon } from './presentation'

export function UsageStatistics({ statistics }: { statistics: MonthlyStatistics }) {
  const deposits = statistics.assetFormation.savingsDepositWon + statistics.assetFormation.investmentDepositWon
  const totalUsage = statistics.totals.expenseWon + deposits
  const total = formatSignedWon(statistics.totals.incomeWon - totalUsage)
  return <>
    <section className="ui-summary" aria-label="월간 자금 사용 요약"><dl><dt>총계</dt><dd className="ui-total" data-long-money={total.length > 16}>{total}</dd><dd className="ui-caption">수입 − 지출 · 적금·투자 납입 포함</dd></dl><dl className="ui-summary-details"><div><dt>수입</dt><dd>{formatSignedWon(statistics.totals.incomeWon)}</dd></div><div><dt>이번 달 지출</dt><dd>{formatSignedWon(-totalUsage)}</dd></div></dl></section>
    <p className="sr-only">지출에는 생활 지출과 적금·투자 납입이 포함돼요. 회수액은 차감하지 않으며, 총계는 수입에서 지출을 뺀 금액으로 실제 계좌 잔액과 달라요.</p>
  </>
}

export function FormationDetails({ statistics }: { statistics: MonthlyStatistics }) {
  const formation = statistics.assetFormation
  return <aside className="ui-soft-panel ui-formation"><div className="ui-section-heading"><h2>차곡차곡 모은 돈</h2><Sprout className="text-[var(--selection)]" size={20}/></div>
    <p className="ui-caption mt-6">이번 달 납입</p><p className="ui-due-amount">{(formation.savingsDepositWon + formation.investmentDepositWon).toLocaleString('ko-KR')}원</p>
    <dl><div><dt>적금 납입</dt><dd>{formation.savingsDepositWon.toLocaleString('ko-KR')}원</dd></div><div><dt>투자 납입</dt><dd>{formation.investmentDepositWon.toLocaleString('ko-KR')}원</dd></div></dl>
    <details><summary>적금·투자 납입과 회수 자세히 보기</summary><div className="grid gap-6" aria-label="월간 적금 투자 요약"><FormationAmount label="적금" deposit={formation.savingsDepositWon} withdrawal={formation.savingsWithdrawalWon}/><FormationAmount label="투자" deposit={formation.investmentDepositWon} withdrawal={formation.investmentWithdrawalWon}/></div></details>
    <p className="ui-caption mt-2">순납입은 납입에서 회수를 뺀 금액이며, 이자·투자 수익이나 현재 잔액은 아니에요.</p>
    <p className="ui-caption mt-4">지출에는 적금·투자 납입이 포함되고 회수액은 차감하지 않아요. 총계는 실제 계좌 잔액과 다를 수 있어요.</p>
  </aside>
}
function FormationAmount({ label, deposit, withdrawal }: { label: string; deposit: number; withdrawal: number }) {
  return <section aria-label={`${label} 납입과 회수`}><h3 className="text-sm font-medium">{label}</h3><dl><div><dt>납입</dt><dd>{formatSignedWon(deposit)}</dd></div><div><dt>회수</dt><dd>{formatSignedWon(withdrawal)}</dd></div><div><dt>순납입</dt><dd>{formatSignedWon(deposit - withdrawal)}</dd></div></dl></section>
}
