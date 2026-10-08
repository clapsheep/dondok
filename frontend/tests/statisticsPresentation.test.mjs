import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryShares, formatFlowWon, usageRanking, yearlyBarSeries } from '../src/features/statistics/presentation.ts'

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

test('가로 막대는 큰 금액 순서와 같은 기준선을 사용하고 분류를 기타로 합치지 않는다', () => {
  const shares = categoryShares([
    { categoryId: 'small', categoryName: '교통', kind: 'EXPENSE', amountWon: 20000 },
    { categoryId: 'large', categoryName: '식비', kind: 'EXPENSE', amountWon: 50000 },
    { categoryId: 'medium', categoryName: '주거', kind: 'EXPENSE', amountWon: 30000 },
  ], 'expense', 100000)
  assert.deepEqual(shares.map((item) => item.categoryId), ['large', 'medium', 'small'])
  assert.deepEqual(shares.map((item) => item.barPercent), [100, 60, 40])
  assert.deepEqual(shares.map((item) => item.ratioPercent), [50, 30, 20])
})

const usage = (categories, savingsDepositWon = 700000, investmentDepositWon = 400000) => ({
  totals: { incomeWon: 3000000, expenseWon: categories.reduce((sum, item) => sum + (item.kind === 'EXPENSE' ? item.amountWon : 0), 0) },
  categoryBreakdown: categories,
  assetFormation: { savingsDepositWon, investmentDepositWon, savingsWithdrawalWon: 200000, investmentWithdrawalWon: 100000 },
})
const expense = (categoryName, amountWon) => ({ categoryId: categoryName, categoryName, amountWon, kind: 'EXPENSE' })

test('생활 지출 분류와 적금·투자 납입은 동일 순위와 총 사용액 비중으로 비교한다', () => {
  const bars = usageRanking(usage([expense('식비', 500000), expense('주거비', 300000), expense('교통비', 100000), { categoryId: 'salary', categoryName: '급여', kind: 'INCOME', amountWon: 3000000 }]))
  assert.deepEqual(bars.map((bar) => bar.label), ['적금', '식비', '투자', '주거비', '교통비'])
  assert.deepEqual(bars.map((bar) => bar.ratioPercent), [35, 25, 20, 15, 5])
  assert.equal(bars.reduce((sum, bar) => sum + bar.amountWon, 0), 2000000)
  assert.equal(bars[0].barPercent, 100)
  assert.equal(bars[0].category, null)
  assert.equal(bars[1].category.categoryId, '식비')
})

test('양수 합계에도 순환불 분류가 있으면 비율을 숨기고 환불 음수를 보존한다', () => {
  const bars = usageRanking(usage([expense('환불', -100000)], 200000, 0))
  assert.deepEqual(bars.map((bar) => bar.amountWon), [200000, -100000])
  assert.ok(bars.every((bar) => bar.ratioPercent === null && bar.barPercent === null))
  assert.deepEqual(usageRanking(usage([], 0, 0)), [])
})

test('동일한 분류명과 납입명은 합치지 않고 회수만 있는 달의 사용액은 0원이다', () => {
  const bars = usageRanking(usage([expense('적금', 700000)], 700000, 0))
  assert.equal(new Set(bars.map((bar) => bar.id)).size, 2)
  assert.deepEqual(bars.map((bar) => bar.ratioPercent), [50, 50])
  assert.deepEqual(usageRanking(usage([], 0, 0)), [])
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
