import { api } from '../../lib/api'
import type { CategoryKind } from '../categories/api'
import { transactionKeys } from '../transactions/api'

export type StatisticsAssetOwnerType = 'ALL' | 'JOINT' | 'MEMBER'

export type StatisticsFilters = {
  month: string
  performedByMemberId: string | null
  assetOwnerType: StatisticsAssetOwnerType
  assetOwnerMemberId: string | null
  categoryId: string | null
}

export type StatisticsAppliedFilters = Omit<StatisticsFilters, 'month'>

export type StatisticsCategoryAmount = {
  categoryId: string
  categoryName: string
  kind: CategoryKind
  amountWon: number
}

export type MonthlyStatistics = {
  month: string
  periodStart: string
  periodEndExclusive: string
  appliedFilters: StatisticsAppliedFilters
  totals: {
    incomeWon: number
    expenseWon: number
    netWon: number
  }
  categoryBreakdown: StatisticsCategoryAmount[]
  yearlyTrend: StatisticsMonthAmount[]
}

export type StatisticsMonthAmount = {
  month: string
  incomeWon: number
  expenseWon: number
  netWon: number
}

export const statisticsKeys = {
  all: [...transactionKeys.all, 'statistics'] as const,
  monthly: (filters: StatisticsFilters) => [
    ...transactionKeys.all,
    'statistics',
    'monthly',
    filters.month,
    filters.performedByMemberId,
    filters.assetOwnerType,
    filters.assetOwnerMemberId,
    filters.categoryId,
  ] as const,
}

export const statisticsApi = {
  monthly: (filters: StatisticsFilters) => {
    const params = new URLSearchParams({ month: filters.month })
    if (filters.performedByMemberId) params.set('performedByMemberId', filters.performedByMemberId)
    if (filters.assetOwnerType !== 'ALL') params.set('assetOwnerType', filters.assetOwnerType)
    if (filters.assetOwnerMemberId) params.set('assetOwnerMemberId', filters.assetOwnerMemberId)
    if (filters.categoryId) params.set('categoryId', filters.categoryId)
    return api<MonthlyStatistics>(`/api/statistics/monthly?${params}`)
  },
}
