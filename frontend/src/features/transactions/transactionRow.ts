import type { Transaction } from './api'

export function transactionRowDestination(transaction: Transaction) {
  if (transaction.managementType === 'CARD_PURCHASE') return `/transactions/${transaction.transactionId}/card-purchase`
  return `/transactions/${transaction.transactionId}`
}

export function transactionRowAmountPrefix(transaction: Transaction) {
  if (transaction.managementType === 'CARD_REFUND' || transaction.type === 'INCOME') return '+'
  if (transaction.type === 'EXPENSE') return '-'
  return ''
}

export function transactionRowTone(transaction: Transaction) {
  if (transaction.managementType === 'CARD_REFUND') return 'text-[var(--transfer)]'
  if (transaction.type === 'INCOME') return 'text-[var(--income)]'
  if (transaction.type === 'EXPENSE') return 'text-[var(--expense)]'
  return 'text-[var(--transfer)]'
}

export function transactionRowAccessibleName(transaction: Transaction, label: string, amount: string) {
  const type = transactionTypeLabel(transaction)
  const statistics = transaction.excludedFromStatistics ? ', 집계 제외' : ''
  return `${label} 거래 상세, ${type} ${amount}${statistics}`
}

export function transactionTypeLabel(transaction: Transaction) {
  if (transaction.managementType === 'CARD_REFUND') return '환불'
  if (transaction.transferSubtype === 'CARD_SETTLEMENT') return '카드 정산'
  if (transaction.transferSubtype === 'CARD_PREPAYMENT') return '카드 선결제'
  return transaction.type === 'INCOME' ? '수입' : transaction.type === 'EXPENSE' ? '지출' : '이체'
}
