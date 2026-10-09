import type { MonthlyStatistics, StatisticsCategoryAmount, StatisticsMonthAmount } from './api'
import type { StatisticsDirection } from './filters'

export type CategoryShare = StatisticsCategoryAmount & {
  ratioPercent: number | null
  barPercent: number | null
}

export function categoryShares(items: StatisticsCategoryAmount[], direction: StatisticsDirection, directionTotalWon: number): CategoryShare[] {
  const kind = direction === 'expense' ? 'EXPENSE' : 'INCOME'
  const directionItems = items.filter((item) => item.kind === kind).sort((a, b) => b.amountWon - a.amountWon || a.categoryName.localeCompare(b.categoryName, 'ko'))
  const maximum = Math.max(0, ...directionItems.map((item) => item.amountWon))
  const ratiosAreMeaningful = directionTotalWon > 0 && directionItems.every((item) => item.amountWon > 0)
  return directionItems
    .map((item) => {
      if (!ratiosAreMeaningful) return { ...item, ratioPercent: null, barPercent: null }
      const ratioPercent = item.amountWon / directionTotalWon * 100
      return { ...item, ratioPercent, barPercent: item.amountWon / maximum * 100 }
    })
}

export function formatFlowWon(value: number, direction: StatisticsDirection) {
  const effect = direction === 'expense' ? -value : value
  return formatSignedWon(effect)
}

export function formatSignedWon(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${new Intl.NumberFormat('ko-KR').format(Math.abs(value))}원`
}

export function formatRatio(value: number) {
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value)}%`
}

export function usageRanking(statistics: Pick<MonthlyStatistics, 'totals' | 'assetFormation' | 'categoryBreakdown'>) {
  const categories = statistics.categoryBreakdown.filter((item) => item.kind === 'EXPENSE').map((category) => ({
    id: `category:${category.categoryId}`, label: category.categoryName, amountWon: category.amountWon, category,
  }))
  const deposits = [
    { id: 'savings', label: '적금', amountWon: statistics.assetFormation.savingsDepositWon, category: null },
    { id: 'investment', label: '투자', amountWon: statistics.assetFormation.investmentDepositWon, category: null },
  ].filter((item) => item.amountWon > 0)
  const items = [...categories, ...deposits].sort((a, b) => b.amountWon - a.amountWon || a.label.localeCompare(b.label, 'ko') || a.id.localeCompare(b.id))
  const total = statistics.totals.expenseWon + statistics.assetFormation.savingsDepositWon + statistics.assetFormation.investmentDepositWon
  const maximum = Math.max(1, ...items.map((item) => item.amountWon))
  const meaningful = total > 0 && items.every((item) => item.amountWon > 0)
  return items.map((item) => ({ ...item, ratioPercent: meaningful ? item.amountWon / total * 100 : null, barPercent: meaningful ? item.amountWon / maximum * 100 : null }))
}

export type YearlyBar = StatisticsMonthAmount & {
  incomePercent: number
  expensePercent: number
  savingsPercent: number
  investmentPercent: number
}

export function yearlyBarSeries(months: StatisticsMonthAmount[]): YearlyBar[] {
  const maximum = months.reduce(
    (current, month) => Math.max(current, Math.abs(month.incomeWon), Math.abs(month.expenseWon), month.assetFormation?.savingsDepositWon ?? 0, month.assetFormation?.investmentDepositWon ?? 0),
    0,
  )
  return months.map((month) => ({
    ...month,
    incomePercent: maximum === 0 ? 0 : Math.abs(month.incomeWon) / maximum * 100,
    expensePercent: maximum === 0 ? 0 : Math.abs(month.expenseWon) / maximum * 100,
    savingsPercent: maximum === 0 ? 0 : (month.assetFormation?.savingsDepositWon ?? 0) / maximum * 100,
    investmentPercent: maximum === 0 ? 0 : (month.assetFormation?.investmentDepositWon ?? 0) / maximum * 100,
  }))
}
