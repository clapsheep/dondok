import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeStatisticsFilterCount,
  parseStatisticsUrl,
  statisticsFiltersFromUrl,
  statisticsSearchParams,
} from '../src/features/statistics/filters.ts'

const memberA = '11111111-1111-4111-8111-111111111111'
const memberB = '22222222-2222-4222-8222-222222222222'
const category = '33333333-3333-4333-8333-333333333333'
const options = { currentMonth: '2026-07', currentMemberId: memberA, validMemberIds: new Set([memberA, memberB]) }

test('필터 없는 URL은 서울 현재 월의 내 통계 보기다', () => {
  const state = parseStatisticsUrl(new URLSearchParams(), options)
  assert.deepEqual(state, {
    month: '2026-07',
    memberId: memberA,
    owner: 'all',
    categoryId: null,
    direction: 'expense',
  })
  assert.equal(statisticsSearchParams(state, memberA).toString(), 'month=2026-07')
})

test('월·구성원·소유 marker·분류·방향을 URL에서 복원한다', () => {
  const state = parseStatisticsUrl(new URLSearchParams({
    month: '2026-06', member: memberA, owner: `member:${memberB}`, category, direction: 'income',
  }), options)
  assert.deepEqual(statisticsFiltersFromUrl(state), {
    month: '2026-06',
    performedByMemberId: memberA,
    assetOwnerType: 'MEMBER',
    assetOwnerMemberId: memberB,
    categoryId: category,
  })
  assert.equal(activeStatisticsFilterCount(state), 2)
  assert.equal(statisticsSearchParams(state, memberA).toString(), `month=2026-06&owner=member%3A${memberB}&category=${category}&direction=income`)
})

test('알 수 없는 멤버는 현재 구성원으로, 잘못된 월·소유자·분류는 기본값으로 해석한다', () => {
  const state = parseStatisticsUrl(new URLSearchParams({
    month: '2026-19', member: 'missing', owner: 'member:missing', category: 'not-a-uuid', direction: 'unknown',
  }), options)
  assert.deepEqual(state, { month: '2026-07', memberId: memberA, owner: 'all', categoryId: null, direction: 'expense' })
})

test('공동 전체 선택은 member=all로 명시해 새로고침 뒤에도 유지한다', () => {
  const state = parseStatisticsUrl(new URLSearchParams({ member: 'all' }), options)
  assert.equal(state.memberId, null)
  assert.equal(statisticsSearchParams(state, memberA).toString(), 'month=2026-07&member=all')
})

test('공동 소유 URL을 API의 JOINT 필터로 변환한다', () => {
  const state = parseStatisticsUrl(new URLSearchParams({ owner: 'joint' }), options)
  assert.equal(statisticsFiltersFromUrl(state).assetOwnerType, 'JOINT')
  assert.equal(statisticsFiltersFromUrl(state).assetOwnerMemberId, null)
})
