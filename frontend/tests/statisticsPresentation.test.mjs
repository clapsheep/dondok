import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryChartTone, categoryChartTones, categoryDonutSlices, categoryShares, formatFlowWon, yearlyBarSeries } from '../src/features/statistics/presentation.ts'

const categories = [
  { categoryId: 'food', categoryName: '식비', kind: 'EXPENSE', amountWon: 120_000 },
  { categoryId: 'refund', categoryName: '여가', kind: 'EXPENSE', amountWon: -20_000 },
  { categoryId: 'salary', categoryName: '급여', kind: 'INCOME', amountWon: 300_000 },
]

test('방향 합계와 모든 분류 순금액이 양수일 때만 비율과 막대를 계산한다', () => {
  const positiveCategories = categories.filter((item) => item.categoryId !== 'refund')
  const shares = categoryShares(positiveCategories, 'expense', 100_000)
  assert.equal(shares[0].ratioPercent, 120)
  assert.equal(shares[0].barPercent, 100)
})

test('분류 하나라도 0원 이하면 해당 방향 전체의 비율과 막대를 숨긴다', () => {
  const shares = categoryShares(categories, 'expense', 100_000)
  assert.ok(shares.every((item) => item.ratioPercent === null && item.barPercent === null))
})

test('방향 합계가 0 이하이면 모든 비율과 막대를 숨긴다', () => {
  assert.ok(categoryShares(categories, 'expense', 0).every((item) => item.ratioPercent === null && item.barPercent === null))
  assert.ok(categoryShares(categories, 'expense', -1).every((item) => item.ratioPercent === null && item.barPercent === null))
})

test('원형 차트 조각은 양수 분류를 전체 원에 맞춰 정규화하고 시작 위치를 이어 계산한다', () => {
  const shares = categoryShares([
    { categoryId: 'food', categoryName: '식비', kind: 'EXPENSE', amountWon: 50_000 },
    { categoryId: 'transport', categoryName: '교통비', kind: 'EXPENSE', amountWon: 30_000 },
    { categoryId: 'living', categoryName: '주거비', kind: 'EXPENSE', amountWon: 20_000 },
  ], 'expense', 100_000)
  const slices = categoryDonutSlices(shares)

  assert.deepEqual(slices.map((slice) => slice.normalizedPercent), [50, 30, 20])
  assert.deepEqual(slices.map((slice) => slice.offsetPercent), [0, 50, 80])
  assert.equal(slices.reduce((sum, slice) => sum + slice.normalizedPercent, 0), 100)
})

test('원형 차트는 수입·지출 의미색 대신 톤이 맞는 여섯 가지 분류색을 순서대로 사용한다', () => {
  assert.equal(new Set(categoryChartTones).size, 6)
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => categoryChartTone(index)), categoryChartTones)
  assert.equal(categoryChartTone(6), categoryChartTones[0])
  assert.ok(categoryChartTones.every((tone) => !['var(--income)', 'var(--expense)'].includes(tone)))
})

test('원형 차트는 상위 5개 뒤의 분류를 기타 한 조각으로 합친다', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    categoryId: `category-${index + 1}`,
    categoryName: `분류 ${index + 1}`,
    kind: 'INCOME',
    amountWon: (8 - index) * 10_000,
  }))
  const shares = categoryShares(items, 'income', items.reduce((sum, item) => sum + item.amountWon, 0))
  const slices = categoryDonutSlices(shares)

  assert.equal(slices.length, 6)
  assert.equal(slices.at(-1).label, '기타 3개')
  assert.deepEqual(slices.at(-1).categoryIds, ['category-6', 'category-7', 'category-8'])
  assert.equal(slices.at(-1).amountWon, 60_000)
})

test('분류가 정확히 6개면 이름을 잃는 기타 조각 없이 모두 유지한다', () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    categoryId: `category-${index + 1}`,
    categoryName: `분류 ${index + 1}`,
    kind: 'EXPENSE',
    amountWon: (6 - index) * 10_000,
  }))
  const shares = categoryShares(items, 'expense', items.reduce((sum, item) => sum + item.amountWon, 0))
  const slices = categoryDonutSlices(shares)

  assert.equal(slices.length, 6)
  assert.deepEqual(slices.map((slice) => slice.label), items.map((item) => item.categoryName))
})

test('환불로 비율이 숨겨진 방향에는 원형 차트 조각을 만들지 않는다', () => {
  assert.deepEqual(categoryDonutSlices(categoryShares(categories, 'expense', 100_000)), [])
})

test('지출 환불은 signed 순효과로 표시한다', () => {
  assert.equal(formatFlowWon(120_000, 'expense'), '-120,000원')
  assert.equal(formatFlowWon(-20_000, 'expense'), '+20,000원')
  assert.equal(formatFlowWon(300_000, 'income'), '+300,000원')
})

test('연간 막대는 수입·지출 절댓값 중 가장 큰 금액을 기준으로 월별 높이를 계산한다', () => {
  const months = [
    { month: '2026-01', incomeWon: 300_000, expenseWon: 150_000, netWon: 150_000 },
    { month: '2026-02', incomeWon: 100_000, expenseWon: -30_000, netWon: 130_000 },
  ]
  const bars = yearlyBarSeries(months)
  assert.equal(bars[0].incomePercent, 100)
  assert.equal(bars[0].expensePercent, 50)
  assert.ok(Math.abs(bars[1].incomePercent - 100 / 3) < 1e-10)
  assert.equal(bars[1].expensePercent, 10)
})

test('연간 기록이 모두 0원이면 열두 달의 막대 높이를 0으로 유지한다', () => {
  const bars = yearlyBarSeries(Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    incomeWon: 0,
    expenseWon: 0,
    netWon: 0,
  })))
  assert.equal(bars.length, 12)
  assert.ok(bars.every((month) => month.incomePercent === 0 && month.expensePercent === 0))
})
