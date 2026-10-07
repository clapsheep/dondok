import type { CardItemPaymentInput, CardPaymentItem, CardPaymentItemPage } from './api'

export type BaseSelection = CardItemPaymentInput['baseSelection']
export type SelectionOverride = { item: CardPaymentItem; checked: boolean }
export function initiallySelected(item: CardPaymentItem, base: BaseSelection, closing: string) {
  return base === 'ALL' || (base === 'CLOSED' && item.cycleEnd <= closing)
}
export function selectionTotals(snapshot: CardPaymentItemPage, base: BaseSelection, overrides: Record<string, SelectionOverride>) {
  let amount = base === 'ALL' ? snapshot.totals.amountWon : base === 'CLOSED' ? snapshot.totals.closedAmountWon : 0
  let count = base === 'ALL' ? snapshot.totals.count : base === 'CLOSED' ? snapshot.totals.closedCount : 0
  for (const { item, checked } of Object.values(overrides)) {
    const before = initiallySelected(item, base, snapshot.recentClosingOn)
    if (before !== checked) { const direction = checked ? 1 : -1; amount += direction * item.remainingAmountWon; count += direction }
  }
  return { amount, count }
}
