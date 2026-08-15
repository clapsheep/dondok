import { isMonth } from '../../lib/month.ts'
import type { CategoryKind } from '../categories/api'
import type { StatisticsFilters } from './api'

export type StatisticsDirection = Lowercase<CategoryKind>
export type StatisticsOwnerFilter = 'all' | 'joint' | `member:${string}`

export type StatisticsUrlState = {
  month: string
  memberId: string | null
  owner: StatisticsOwnerFilter
  categoryId: string | null
  direction: StatisticsDirection
}

type ParseOptions = {
  currentMonth: string
  currentMemberId: string
  validMemberIds: ReadonlySet<string>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseStatisticsUrl(params: URLSearchParams, options: ParseOptions): StatisticsUrlState {
  const month = isMonth(params.get('month')) ? params.get('month')! : options.currentMonth
  const memberCandidate = params.get('member')
  const memberId = memberCandidate === 'all'
    ? null
    : memberCandidate && options.validMemberIds.has(memberCandidate)
      ? memberCandidate
      : options.currentMemberId
  const owner = parseOwner(params.get('owner'), options.validMemberIds)
  const categoryCandidate = params.get('category')
  const categoryId = categoryCandidate && UUID_PATTERN.test(categoryCandidate) ? categoryCandidate : null
  const direction = params.get('direction') === 'income' ? 'income' : 'expense'
  return { month, memberId, owner, categoryId, direction }
}

export function statisticsFiltersFromUrl(state: StatisticsUrlState): StatisticsFilters {
  if (state.owner === 'joint') {
    return {
      month: state.month,
      performedByMemberId: state.memberId,
      assetOwnerType: 'JOINT',
      assetOwnerMemberId: null,
      categoryId: state.categoryId,
    }
  }
  if (state.owner.startsWith('member:')) {
    return {
      month: state.month,
      performedByMemberId: state.memberId,
      assetOwnerType: 'MEMBER',
      assetOwnerMemberId: state.owner.slice('member:'.length),
      categoryId: state.categoryId,
    }
  }
  return {
    month: state.month,
    performedByMemberId: state.memberId,
    assetOwnerType: 'ALL',
    assetOwnerMemberId: null,
    categoryId: state.categoryId,
  }
}

export function statisticsSearchParams(state: StatisticsUrlState, currentMemberId: string) {
  const params = new URLSearchParams({ month: state.month })
  if (state.memberId === null) params.set('member', 'all')
  else if (state.memberId !== currentMemberId) params.set('member', state.memberId)
  if (state.owner !== 'all') params.set('owner', state.owner)
  if (state.categoryId) params.set('category', state.categoryId)
  if (state.direction !== 'expense') params.set('direction', state.direction)
  return params
}

export function activeStatisticsFilterCount(state: StatisticsUrlState) {
  return Number(state.owner !== 'all') + Number(Boolean(state.categoryId))
}

function parseOwner(value: string | null, validMemberIds: ReadonlySet<string>): StatisticsOwnerFilter {
  if (value === 'joint') return 'joint'
  if (!value?.startsWith('member:')) return 'all'
  const memberId = value.slice('member:'.length)
  return validMemberIds.has(memberId) ? `member:${memberId}` : 'all'
}
