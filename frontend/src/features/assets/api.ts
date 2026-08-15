import { api, jsonBody } from '../../lib/api'
import type { FinancialInstitutionCode } from './financialInstitutions'

export type AssetBehavior = 'STANDARD' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'SAVINGS'
export type OwnershipScope = 'PERSONAL' | 'JOINT'
export type AssetStatus = 'ACTIVE' | 'ARCHIVED'
export type AssetListStatus = AssetStatus | 'ALL'
export type AssetTypeSystemCode = 'CASH' | 'BANK' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'SAVINGS' | 'INVESTMENT' | 'LOAN' | 'INSURANCE' | 'OTHER'

export type AssetType = {
  assetTypeId: string
  systemCode: AssetTypeSystemCode
  name: string
  behavior: AssetBehavior
  paymentSourceCapable: boolean
}

export type CardSettings = {
  statementClosingDay: number
  paymentDay: number
  paymentMonthOffset: number
  settlementAssetId: string | null
  autoSettlementEnabled: boolean
}

export type CardSettingsInput = {
  statementClosingDay: number
  paymentDay: number
  paymentMonthOffset: number
  settlementAssetId: string
  autoSettlementEnabled: boolean
}

export type DebitCardSettings = {
  paymentAssetId: string
}

export type SavingsSettings = {
  transferAssetId: string
  transferDay: number
}

export type Asset = {
  assetId: string
  assetTypeId: string
  assetTypeName: string
  systemCode: AssetTypeSystemCode
  behavior: AssetBehavior
  paymentSourceCapable: boolean
  ownershipScope: OwnershipScope
  ownerMemberId: string | null
  financialInstitutionCode: FinancialInstitutionCode | null
  name: string
  openedOn: string
  memo: string | null
  openingBalanceWon: number
  currentBalanceWon: number
  currentMonthCardPaymentDueWon: number
  nextMonthCardPaymentDueWon: number
  status: AssetStatus
  archivedAt: string | null
  version: number
  cardSettings: CardSettings | null
  debitCardSettings: DebitCardSettings | null
  savingsSettings: SavingsSettings | null
}

export type CreateAssetInput = {
  assetTypeId: string
  ownershipScope: OwnershipScope
  ownerMemberId: string | null
  financialInstitutionCode: FinancialInstitutionCode | null
  name: string
  openedOn: string
  memo: string | null
  openingBalanceWon: number
  cardSettings: CardSettingsInput | null
  debitCardSettings: DebitCardSettings | null
  savingsSettings: SavingsSettings | null
}

export type UpdateAssetInput = CreateAssetInput & {
  expectedVersion: number
  reassignTransactionsToNewOwner: boolean
}

export type AssetRemovalDisposition = 'DELETE' | 'ARCHIVE'
export type AssetRemovalBlockingLinkKind = 'CREDIT_CARD_SETTLEMENT' | 'DEBIT_CARD_PAYMENT' | 'SAVINGS_TRANSFER' | 'CARD_PAYMENT_SCHEDULE'

export type AssetRemovalBlockingLink = {
  kind: AssetRemovalBlockingLinkKind
  assetId: string
  assetName: string
}

export type AssetRemovalPreview = {
  assetId: string
  name: string
  disposition: AssetRemovalDisposition
  currentBalanceWon: number
  historyTransactionCount: number
  unpaidCardStatementCount: number
  blockingLinks: AssetRemovalBlockingLink[]
  expectedVersion: number
  previewToken: string
}

export type AssetRemovalResult = {
  assetId: string
  name: string
  disposition: 'DELETED' | 'ARCHIVED'
  currentBalanceWon: number
  removedAt: string
}

export const assetKeys = {
  all: ['assets'] as const,
  list: ['assets', 'list', 'ACTIVE'] as const,
  listByStatus: (status: AssetListStatus) => ['assets', 'list', status] as const,
  detail: (assetId: string) => ['assets', 'detail', assetId] as const,
  removalPreview: (assetId: string) => ['assets', 'removal-preview', assetId] as const,
  types: ['asset-types'] as const,
}

export const assetApi = {
  types: () => api<AssetType[]>('/api/asset-types'),
  list: () => api<Asset[]>('/api/assets'),
  listByStatus: (status: AssetListStatus) => api<Asset[]>(status === 'ACTIVE' ? '/api/assets' : `/api/assets?status=${status}`),
  detail: (assetId: string) => api<Asset>(`/api/assets/${assetId}`),
  removalPreview: (assetId: string) => api<AssetRemovalPreview>(`/api/assets/${assetId}/removal-preview`),
  create: (input: CreateAssetInput, idempotencyKey: string) => api<Asset>('/api/assets', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: jsonBody(input),
  }),
  update: (assetId: string, input: UpdateAssetInput) => api<Asset>(`/api/assets/${assetId}`, {
    method: 'PUT',
    body: jsonBody(input),
  }),
  remove: (assetId: string, expectedVersion: number, previewToken: string) => {
    const params = new URLSearchParams({ expectedVersion: String(expectedVersion), previewToken })
    return api<AssetRemovalResult>(`/api/assets/${assetId}?${params}`, { method: 'DELETE' })
  },
}
