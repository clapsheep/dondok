import type { QueryClient } from '@tanstack/react-query'
import type { SessionUser } from '../../lib/api'
import type { CurrentLedgerBook, LedgerBook } from './api'

export const LEDGER_DELETION_CONFIRMATION_PHRASE = '가계부 삭제' as const
const CURRENT_LEDGER_QUERY_KEY = ['ledger', 'current'] as const

export type LedgerExitReason = 'DELETED' | 'DELETED_REMOTELY' | 'LEDGER_CHANGED'
export type LedgerNavigationState = { ledgerExit?: LedgerExitReason }

export function isLedgerDeletionConfirmed(value: string) {
  return value === LEDGER_DELETION_CONFIRMATION_PHRASE
}

export function snapshotLedger(ledger: LedgerBook): LedgerBook {
  return { ...ledger, members: ledger.members.map((member) => ({ ...member })) }
}

export function ledgerExitReasonAfterCurrentRead(current: CurrentLedgerBook, previousLedgerId: string | undefined): LedgerExitReason | null {
  if (!current.ledger) return 'DELETED_REMOTELY'
  if (previousLedgerId && current.ledger.ledgerId !== previousLedgerId) return 'LEDGER_CHANGED'
  return null
}

export async function replaceLedgerClientState(queryClient: QueryClient, current: CurrentLedgerBook) {
  const session = queryClient.getQueryData<SessionUser>(['session'])
  await queryClient.cancelQueries()
  queryClient.clear()
  if (session) queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(CURRENT_LEDGER_QUERY_KEY, current)
}
