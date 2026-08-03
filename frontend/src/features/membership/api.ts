import { api, jsonBody } from '../../lib/api'

export type LedgerMember = {
  memberId: string
  displayName: string
  joinedAt: string
  currentUser: boolean
}

export type LedgerBook = {
  ledgerId: string
  version: number
  members: LedgerMember[]
}

export type CurrentLedgerBook = { ledger: LedgerBook | null }

export type DeleteLedgerBookInput = {
  expectedLedgerId: string
  expectedVersion: number
  confirmationPhrase: '가계부 삭제'
}

export type InvitationStatus = 'ACTIVE' | 'REDEEMED' | 'REVOKED' | 'EXPIRED'

export type LedgerInvitationSummary = {
  invitationId: string
  status: InvitationStatus
  createdAt: string
  expiresAt: string
}

export type IssuedLedgerInvitation = LedgerInvitationSummary & {
  code: string
  inviteUrl: string
}

export type LedgerInvitationPreview = {
  memberNames: string[]
  memberCount: number
  expiresAt: string
}

export const membershipKeys = {
  current: ['ledger', 'current'] as const,
  invitations: ['ledger', 'invitations'] as const,
}

export const membershipApi = {
  current: () => api<CurrentLedgerBook>('/api/ledger-books/current'),
  deleteCurrent: (input: DeleteLedgerBookInput) => api<void>('/api/ledger-books/current', {
    method: 'DELETE',
    body: jsonBody(input),
  }, { notifyLedgerNotFound: false }),
  createLedger: () => api<LedgerBook>('/api/ledger-books', { method: 'POST' }),
  invitations: () => api<LedgerInvitationSummary[]>('/api/ledger-books/current/invitations'),
  issueInvitation: () => api<IssuedLedgerInvitation>('/api/ledger-books/current/invitations', { method: 'POST' }),
  revokeInvitation: (invitationId: string) => api<void>(`/api/ledger-books/current/invitations/${invitationId}`, { method: 'DELETE' }),
  previewInvitation: (code: string) => api<LedgerInvitationPreview>('/api/ledger-invitations/preview', { method: 'POST', body: jsonBody({ code }) }),
  redeemInvitation: (code: string) => api<LedgerBook>('/api/ledger-invitations/redemptions', { method: 'POST', body: jsonBody({ code }) }),
}
