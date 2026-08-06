import assert from 'node:assert/strict'
import test from 'node:test'
import { compactCalendarWon, nextCalendarDate, selectedDateForMonth, shiftCalendarDate } from '../src/features/home/calendarPresentation.ts'

test('달력 금액은 좁은 날짜 셀에서 읽을 수 있는 길이로 축약한다', () => {
  assert.equal(compactCalendarWon(9_999), '9999')
  assert.equal(compactCalendarWon(188_888), '18.9만')
  assert.equal(compactCalendarWon(3_998_000), '400만')
  assert.equal(compactCalendarWon(21_123_000), '2.1천만')
  assert.equal(compactCalendarWon(877_816_000), '8.8억')
  assert.equal(compactCalendarWon(3_500_000_000), '35억')
  assert.equal(compactCalendarWon(250_000_000_000), '0.3조')

  for (const value of [9_999, 99_999, 999_999, 9_999_999, 99_999_999, 999_999_999, 99_999_999_999, 999_999_999_999]) {
    assert.ok(compactCalendarWon(value).length <= 5)
  }
})

test('선택일은 조회 월 안에서 복원하고 하루 범위를 계산한다', () => {
  assert.equal(selectedDateForMonth('2026-08-14', '2026-08', '2026-08-06'), '2026-08-14')
  assert.equal(selectedDateForMonth('2026-09-01', '2026-08', '2026-08-06'), '2026-08-06')
  assert.equal(selectedDateForMonth('2026-02-30', '2026-02', '2026-08-06'), '2026-02-01')
  assert.equal(nextCalendarDate('2026-08-31'), '2026-09-01')
  assert.equal(shiftCalendarDate('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftCalendarDate('2028-02-28', 1), '2028-02-29')
})
