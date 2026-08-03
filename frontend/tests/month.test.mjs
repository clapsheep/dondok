import assert from 'node:assert/strict'
import test from 'node:test'
import { addMonths, currentMonthInSeoul, isMonth, monthBounds, monthTitle, todayInSeoul } from '../src/lib/month.ts'

test('월 URL 형식과 연도 경계를 안전하게 계산한다', () => {
  assert.equal(isMonth('2026-07'), true)
  assert.equal(isMonth('2026-13'), false)
  assert.equal(addMonths('2026-12', 1), '2027-01')
  assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01', toExclusive: '2027-01-01' })
  assert.equal(monthTitle('2026-07'), '2026년 7월')
})

test('서울 시간대의 현재 월을 구한다', () => {
  assert.equal(currentMonthInSeoul(new Date('2026-06-30T15:30:00Z')), '2026-07')
  assert.equal(todayInSeoul(new Date('2026-06-30T15:30:00Z')), '2026-07-01')
})
