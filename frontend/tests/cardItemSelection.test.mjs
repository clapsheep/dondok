import test from 'node:test'
import assert from 'node:assert/strict'
import { initiallySelected, selectionTotals } from '../src/features/card-statements/itemSelection.ts'
const page = { recentClosingOn: '2026-09-30', totals: { amountWon: 90000, count: 3, closedAmountWon: 30000, closedCount: 1 } }
const closed = { chargeId: 'closed', cycleEnd: '2026-09-30', remainingAmountWon: 30000 }
const future = { chargeId: 'future', cycleEnd: '2026-10-31', remainingAmountWon: 30000 }
test('closed selection includes unseen rows but excludes future installment cycles', () => {
  assert.equal(initiallySelected(closed, 'CLOSED', page.recentClosingOn), true)
  assert.equal(initiallySelected(future, 'CLOSED', page.recentClosingOn), false)
  assert.deepEqual(selectionTotals(page, 'CLOSED', {}), { amount: 30000, count: 1 })
  assert.deepEqual(selectionTotals(page, 'ALL', {}), { amount: 90000, count: 3 })
})
test('explicit unchecking and future selection adjust full summary once', () => {
  const overrides = { closed: { item: closed, checked: false }, future: { item: future, checked: true } }
  assert.deepEqual(selectionTotals(page, 'CLOSED', overrides), { amount: 30000, count: 1 })
  assert.deepEqual(selectionTotals(page, 'NONE', overrides), { amount: 30000, count: 1 })
  assert.deepEqual(selectionTotals(page, 'ALL', overrides), { amount: 60000, count: 2 })
})
