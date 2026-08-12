import { api, jsonBody } from '../../lib/api'

export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER'
export type TransactionManagementType = 'GENERAL' | 'CARD_PURCHASE' | 'CARD_REFUND' | 'SYSTEM'

export type CalendarDay = {
  date: string
  incomeWon: number
  expenseWon: number
  netWon: number
}

export type MonthlyCalendar = {
  month: string
  totalIncomeWon: number
  totalExpenseWon: number
  netWon: number
  days: CalendarDay[]
}

export type Transaction = {
  transactionId: string
  type: TransactionType
  transferSubtype: 'NORMAL' | 'CARD_SETTLEMENT' | 'CARD_PREPAYMENT' | null
  managementType: TransactionManagementType
  relatedPurchaseTransactionId: string | null
  occurredOn: string
  amountWon: number
  category: { categoryId: string; name: string } | null
  performedBy: { memberId: string; displayName: string } | null
  createdBy: { memberId: string; displayName: string } | null
  asset: { assetId: string; name: string } | null
  description: string | null
  excludedFromStatistics: boolean
  postings: { assetId: string; assetName: string; deltaWon: number }[]
  installmentCount: number | null
  version: number
  createdAt: string
  updatedAt: string
}

export type TransactionPage = { items: Transaction[]; nextCursor: string | null }

export type CommonTransactionInput = {
  occurredOn: string
  amountWon: number
  performedByMemberId: string
  description?: string
}

export type CreateTransactionInput =
  | CommonTransactionInput & { type: 'INCOME'; categoryId: string; assetId: string; excludedFromStatistics: boolean }
  | CommonTransactionInput & { type: 'EXPENSE'; categoryId: string; assetId: string; installmentCount?: number; excludedFromStatistics: boolean }
  | CommonTransactionInput & { type: 'TRANSFER'; sourceAssetId: string; destinationAssetId: string }

export type UpdateTransactionInput = (
  | CommonTransactionInput & { type: 'INCOME'; categoryId: string; assetId: string; excludedFromStatistics: boolean }
  | CommonTransactionInput & { type: 'EXPENSE'; categoryId: string; assetId: string; installmentCount?: number; excludedFromStatistics: boolean }
  | CommonTransactionInput & { type: 'TRANSFER'; sourceAssetId: string; destinationAssetId: string }
) & { expectedVersion: number }

export type DeleteTransactionResult = { transactionId: string; deletedVersion: number }

export type CardPurchaseBillingSnapshot = {
  cardAssetId: string
  cardAssetName: string
  statementClosingDay: number
  paymentDay: number
  paymentMonthOffset: number
  installmentCount: number
}

export type CardPurchaseCharge = {
  chargeId: string
  installmentNo: number
  installmentCount: number
  principalAmountWon: number
  refundedAmountWon: number
  refundableAmountWon: number
  expectedSettlementOn: string
  statementId: string
}

export type CardStatementPayment = {
  paymentId: string
  paymentType: string
  settlementAssetId: string
  settlementAssetName: string
  amountWon: number
  returnedAmountWon: number
  effectiveAmountWon: number
  paidOn: string
}

export type CardPurchaseStatement = {
  statementId: string
  dueOn: string
  status: string
  grossAmountWon: number
  paidAmountWon: number
  paymentAmountWon: number
  version: number
  payments: CardStatementPayment[]
}

export type CardPurchaseAccountReturn = {
  assetId: string
  assetName: string
  amountWon: number
}

export type CardPurchaseRefund = {
  refundId: string
  refundTransactionId: string
  refundedOn: string
  amountWon: number
  excludedFromStatistics: boolean
  unpaidCardReductionWon: number
  accountReturns: CardPurchaseAccountReturn[]
}

export type CardPurchaseManagementView = {
  purchase: Transaction
  billingSnapshot: CardPurchaseBillingSnapshot
  refundableAmountWon: number
  charges: CardPurchaseCharge[]
  statements: CardPurchaseStatement[]
  refunds: CardPurchaseRefund[]
}

export type CardPurchaseCorrectionInput = {
  occurredOn: string
  amountWon: number
  categoryId: string
  cardAssetId: string
  performedByMemberId: string
  description?: string
  installmentCount: number
  expectedVersion: number
  excludedFromStatistics: boolean
}

export type CardPurchaseCorrectionPreview = {
  previewToken: string
  purchaseVersion: number
  unpaidCardReductionWon: number
  accountReturns: CardPurchaseAccountReturn[]
}

export type CardPurchaseRefundInput = {
  refundedOn: string
  amountWon: number
  expectedVersion: number
  description?: string
  excludedFromStatistics: boolean
}

export type CardPurchaseRefundPreview = {
  previewToken: string
  purchaseVersion: number
  refundableAmountWon: number
  unpaidCardReductionWon: number
  accountReturns: CardPurchaseAccountReturn[]
}

export type CardPurchaseRefundResult = {
  purchase: Transaction
  refundTransaction: Transaction
  unpaidCardReductionWon: number
  accountReturns: CardPurchaseAccountReturn[]
}

export const transactionKeys = {
  all: ['transactions'] as const,
  calendar: (month: string, performedByMemberId?: string) => ['transactions', 'calendar', month, performedByMemberId ?? 'all'] as const,
  list: (from: string, toExclusive: string, performedByMemberId?: string) => ['transactions', 'list', from, toExclusive, performedByMemberId ?? 'all'] as const,
  detail: (transactionId: string) => ['transactions', 'detail', transactionId] as const,
  cardPurchaseManagement: (transactionId: string) => ['transactions', 'card-purchase-management', transactionId] as const,
}

export const transactionApi = {
  calendar: (month: string, performedByMemberId?: string) => {
    const params = new URLSearchParams({ month })
    if (performedByMemberId) params.set('performedByMemberId', performedByMemberId)
    return api<MonthlyCalendar>(`/api/transactions/calendar?${params}`)
  },
  list: ({ from, toExclusive, cursor, limit = 50, performedByMemberId }: { from: string; toExclusive: string; cursor?: string | null; limit?: number; performedByMemberId?: string }) => {
    const params = new URLSearchParams({ from, toExclusive, limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    if (performedByMemberId) params.set('performedByMemberId', performedByMemberId)
    return api<TransactionPage>(`/api/transactions?${params}`)
  },
  detail: (transactionId: string) => api<Transaction>(`/api/transactions/${transactionId}`),
  create: (input: CreateTransactionInput, idempotencyKey: string) => api<Transaction>('/api/transactions', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: jsonBody(input),
  }),
  update: (transactionId: string, input: UpdateTransactionInput) => api<Transaction>(`/api/transactions/${transactionId}`, {
    method: 'PUT',
    body: jsonBody(input),
  }),
  remove: (transactionId: string, expectedVersion: number) => api<DeleteTransactionResult>(`/api/transactions/${transactionId}?expectedVersion=${expectedVersion}`, {
    method: 'DELETE',
  }),
  cardPurchaseManagement: (transactionId: string) => api<CardPurchaseManagementView>(`/api/transactions/${transactionId}/card-purchase-management`),
  previewCardPurchaseCorrection: (transactionId: string, input: CardPurchaseCorrectionInput) => api<CardPurchaseCorrectionPreview>(`/api/transactions/${transactionId}/card-purchase-corrections/preview`, {
    method: 'POST',
    body: jsonBody(input),
  }),
  applyCardPurchaseCorrection: (transactionId: string, input: CardPurchaseCorrectionInput & { previewToken: string }, idempotencyKey: string) => api<CardPurchaseManagementView>(`/api/transactions/${transactionId}/card-purchase-corrections`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: jsonBody(input),
  }),
  previewCardPurchaseRefund: (transactionId: string, input: CardPurchaseRefundInput) => api<CardPurchaseRefundPreview>(`/api/transactions/${transactionId}/card-purchase-refunds/preview`, {
    method: 'POST',
    body: jsonBody(input),
  }),
  applyCardPurchaseRefund: (transactionId: string, input: CardPurchaseRefundInput & { previewToken: string }, idempotencyKey: string) => api<CardPurchaseRefundResult>(`/api/transactions/${transactionId}/card-purchase-refunds`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: jsonBody(input),
  }),
}
