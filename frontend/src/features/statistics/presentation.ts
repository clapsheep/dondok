import type { StatisticsCategoryAmount, StatisticsMonthAmount } from './api'
import type { StatisticsDirection } from './filters'

export type CategoryShare = StatisticsCategoryAmount & {
  ratioPercent: number | null
  barPercent: number | null
}

export type CategoryDonutSlice = {
  key: string
  label: string
  amountWon: number
  normalizedPercent: number
  offsetPercent: number
  categoryIds: string[]
}

export const categoryChartTones = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const

export function categoryChartTone(index: number) {
  return categoryChartTones[index % categoryChartTones.length] ?? categoryChartTones[0]
}

export function categoryShares(items: StatisticsCategoryAmount[], direction: StatisticsDirection, directionTotalWon: number): CategoryShare[] {
  const kind = direction === 'expense' ? 'EXPENSE' : 'INCOME'
  const directionItems = items.filter((item) => item.kind === kind)
  const ratiosAreMeaningful = directionTotalWon > 0 && directionItems.every((item) => item.amountWon > 0)
  return directionItems
    .map((item) => {
      if (!ratiosAreMeaningful) return { ...item, ratioPercent: null, barPercent: null }
      const ratioPercent = item.amountWon / directionTotalWon * 100
      return { ...item, ratioPercent, barPercent: Math.min(100, ratioPercent) }
    })
}

export function categoryDonutSlices(shares: CategoryShare[]): CategoryDonutSlice[] {
  if (!shares.length || shares.some((item) => item.ratioPercent === null || item.amountWon <= 0)) return []

  const visibleSliceLimit = 6
  const leading = shares.length > visibleSliceLimit ? shares.slice(0, visibleSliceLimit - 1) : shares
  const groups: Array<{ key: string; label: string; amountWon: number; categoryIds: string[] }> = leading.map((item) => ({
    key: item.categoryId,
    label: item.categoryName,
    amountWon: item.amountWon,
    categoryIds: [item.categoryId],
  }))
  if (shares.length > visibleSliceLimit) {
    const remaining = shares.slice(visibleSliceLimit - 1)
    groups.push({
      key: `other-${remaining[0].categoryId}`,
      label: `기타 ${remaining.length}개`,
      amountWon: remaining.reduce((sum, item) => sum + item.amountWon, 0),
      categoryIds: remaining.map((item) => item.categoryId),
    })
  }

  const chartTotalWon = groups.reduce((sum, item) => sum + item.amountWon, 0)
  if (chartTotalWon <= 0) return []
  let offsetPercent = 0
  return groups.map((group) => {
    const normalizedPercent = group.amountWon / chartTotalWon * 100
    const slice = { ...group, normalizedPercent, offsetPercent }
    offsetPercent += normalizedPercent
    return slice
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

export type YearlyBar = StatisticsMonthAmount & {
  incomePercent: number
  expensePercent: number
}

export function yearlyBarSeries(months: StatisticsMonthAmount[]): YearlyBar[] {
  const maximum = months.reduce(
    (current, month) => Math.max(current, Math.abs(month.incomeWon), Math.abs(month.expenseWon)),
    0,
  )
  return months.map((month) => ({
    ...month,
    incomePercent: maximum === 0 ? 0 : Math.abs(month.incomeWon) / maximum * 100,
    expensePercent: maximum === 0 ? 0 : Math.abs(month.expenseWon) / maximum * 100,
  }))
}
