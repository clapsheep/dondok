import { api, jsonBody } from '../../lib/api'
import type { Transaction } from '../transactions/api'

export type CardStatementStatus = 'OPEN' | 'FINALIZED' | 'PAID' | 'CANCELLED'
export type CardStatementPaymentType = 'PREPAYMENT' | 'REGULAR'
export type CardPaymentScheduleStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export type CardPaymentSchedule = {
  scheduleId: string
  scheduledOn: string
  status: CardPaymentScheduleStatus
  attemptCount: number
  nextRetryAt: string | null
}

export type CardStatementPayment = {
  paymentId: string
  paymentType: CardStatementPaymentType
  settlementAssetId: string
  settlementAssetName: string
  amountWon: number
  returnedAmountWon: number
  effectiveAmountWon: number
  paidOn: string
  settlementTransactionId: string
  createdByMemberId: string | null
}

export type CardStatementSummary = {
  statementId: string
  cardAsset: { assetId: string; name: string }
  dueOn: string
  status: CardStatementStatus
  grossAmountWon: number
  paidAmountWon: number
  remainingAmountWon: number
  version: number
  automaticSettlement: CardPaymentSchedule | null
}

export type CardSettlementAsset = {
  assetId: string
  name: string
  currentBalanceWon: number
}

export type CardStatementDetail = CardStatementSummary & {
  prepayableAmountWon: number
  settlementAsset: CardSettlementAsset | null
  autoSettlementEnabled: boolean
  payments: CardStatementPayment[]
}

export type CardStatementPage = {
  items: CardStatementSummary[]
  nextCursor: string | null
}

export type CreateCardStatementPrepaymentInput = {
  amountWon: number
  expectedVersion: number
}

export type ApplyCardStatementPrepaymentInput = CreateCardStatementPrepaymentInput & {
  previewToken: string
}

export type CardStatementPrepaymentPreview = {
  previewToken: string
  statementVersion: number
  amountWon: number
  appliedOn: string
  currentRemainingAmountWon: number
  afterRemainingAmountWon: number
  settlementAsset: CardSettlementAsset
  afterSettlementAssetBalanceWon: number
}

export type CardStatementPaymentResult = {
  statement: CardStatementDetail
  payment: CardStatementPayment
  settlementTransaction: Transaction
}

export type CorrectCardStatementPaymentAccountInput = {
  settlementAssetId: string
  expectedVersion: number
}

export const cardStatementKeys = {
  all: ['card-statements'] as const,
  lists: () => ['card-statements', 'list'] as const,
  list: (cardAssetId: string, includePaid: boolean) => ['card-statements', 'list', cardAssetId, { includePaid }] as const,
  details: () => ['card-statements', 'detail'] as const,
  detail: (statementId: string) => ['card-statements', 'detail', statementId] as const,
}

export const cardStatementApi = {
  list: ({ cardAssetId, cursor, limit = 20, includePaid = false }: { cardAssetId: string; cursor?: string | null; limit?: number; includePaid?: boolean }) => {
    const params = new URLSearchParams({ limit: String(limit), includePaid: String(includePaid) })
    if (cursor) params.set('cursor', cursor)
    return api<CardStatementPage>(`/api/assets/${cardAssetId}/card-statements?${params}`)
  },
  detail: (statementId: string) => api<CardStatementDetail>(`/api/card-statements/${statementId}`),
  previewPrepayment: (statementId: string, input: CreateCardStatementPrepaymentInput) => api<CardStatementPrepaymentPreview>(`/api/card-statements/${statementId}/prepayments/preview`, {
    method: 'POST',
    body: jsonBody(input),
  }),
  applyPrepayment: (statementId: string, input: ApplyCardStatementPrepaymentInput, idempotencyKey: string) => api<CardStatementPaymentResult>(`/api/card-statements/${statementId}/prepayments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: jsonBody(input),
  }),
  correctPaymentAccount: (statementId: string, paymentId: string, input: CorrectCardStatementPaymentAccountInput) => api<CardStatementPaymentResult>(`/api/card-statements/${statementId}/payments/${paymentId}`, {
    method: 'PUT',
    body: jsonBody(input),
  }),
}
