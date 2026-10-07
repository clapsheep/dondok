export type TransferPurpose = 'GENERAL' | 'SAVINGS_DEPOSIT' | 'INVESTMENT_DEPOSIT' | 'SAVINGS_WITHDRAWAL' | 'INVESTMENT_WITHDRAWAL'

export const transferPurposeLabels: Record<TransferPurpose, string> = {
  GENERAL: '일반 이체',
  SAVINGS_DEPOSIT: '적금 납입',
  INVESTMENT_DEPOSIT: '투자 납입',
  SAVINGS_WITHDRAWAL: '적금 인출',
  INVESTMENT_WITHDRAWAL: '투자 인출',
}

export function suggestedTransferPurpose(sourceCode?: string | null, destinationCode?: string | null): TransferPurpose {
  if (sourceCode === 'BANK' && destinationCode === 'SAVINGS') return 'SAVINGS_DEPOSIT'
  if (sourceCode === 'BANK' && destinationCode === 'INVESTMENT') return 'INVESTMENT_DEPOSIT'
  if (sourceCode === 'SAVINGS' && destinationCode === 'BANK') return 'SAVINGS_WITHDRAWAL'
  if (sourceCode === 'INVESTMENT' && destinationCode === 'BANK') return 'INVESTMENT_WITHDRAWAL'
  return 'GENERAL'
}
