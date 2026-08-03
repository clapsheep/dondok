import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { api, subscribeLedgerNotFound } from '../src/lib/api.ts'
import {
  isLedgerDeletionConfirmed,
  ledgerExitReasonAfterCurrentRead,
  replaceLedgerClientState,
  snapshotLedger,
} from '../src/features/membership/ledgerLifecycle.ts'

test('가계부 삭제 확인 문구는 공백을 포함해 정확히 일치해야 한다', () => {
  assert.equal(isLedgerDeletionConfirmed('가계부 삭제'), true)
  assert.equal(isLedgerDeletionConfirmed(' 가계부 삭제'), false)
  assert.equal(isLedgerDeletionConfirmed('가계부삭제'), false)
  assert.equal(isLedgerDeletionConfirmed('영구 삭제'), false)
})

test('current 재조회는 null 또는 다른 가계부일 때만 전환 근거가 된다', () => {
  assert.equal(ledgerExitReasonAfterCurrentRead({ ledger: null }, 'ledger-1'), 'DELETED_REMOTELY')
  assert.equal(ledgerExitReasonAfterCurrentRead({ ledger: { ledgerId: 'ledger-2' } }, 'ledger-1'), 'LEDGER_CHANGED')
  assert.equal(ledgerExitReasonAfterCurrentRead({ ledger: { ledgerId: 'ledger-1' } }, 'ledger-1'), null)
  assert.equal(ledgerExitReasonAfterCurrentRead({ ledger: { ledgerId: 'ledger-1' } }, undefined), null)
})

test('삭제 dialog를 열 때 본 가계부와 구성원 snapshot을 고정한다', () => {
  const ledger = {
    ledgerId: 'ledger-1',
    version: 3,
    members: [{ memberId: 'member-1', displayName: '가람', joinedAt: '2026-07-18T00:00:00Z', currentUser: true }],
  }
  const snapshot = snapshotLedger(ledger)

  ledger.version = 4
  ledger.members[0].displayName = '변경된 이름'

  assert.equal(snapshot.version, 3)
  assert.equal(snapshot.members[0].displayName, '가람')
})

test('가계부 상태 전환은 세션만 보존하고 모든 기존 query와 mutation 상태를 비운다', async () => {
  const queryClient = new QueryClient()
  const session = { userId: 'user-1', loginId: 'user', displayName: '가람', email: 'user@example.com' }
  queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(['ledger', 'current'], { ledger: { ledgerId: 'old-ledger' } })
  queryClient.setQueryData(['ledger', 'invitations'], [{ invitationId: 'invite-1' }])
  queryClient.setQueryData(['assets', 'list'], [{ assetId: 'asset-1' }])
  queryClient.setQueryData(['transactions', 'list'], [{ transactionId: 'transaction-1' }])
  queryClient.setQueryData(['categories', 'list'], [{ categoryId: 'category-1' }])
  queryClient.setQueryData(['card-statements', 'detail'], { statementId: 'statement-1' })

  await replaceLedgerClientState(queryClient, { ledger: null })

  assert.deepEqual(queryClient.getQueryData(['session']), session)
  assert.deepEqual(queryClient.getQueryData(['ledger', 'current']), { ledger: null })
  assert.equal(queryClient.getQueryData(['ledger', 'invitations']), undefined)
  assert.equal(queryClient.getQueryData(['assets', 'list']), undefined)
  assert.equal(queryClient.getQueryData(['transactions', 'list']), undefined)
  assert.equal(queryClient.getQueryData(['categories', 'list']), undefined)
  assert.equal(queryClient.getQueryData(['card-statements', 'detail']), undefined)
  assert.equal(queryClient.getQueryCache().getAll().length, 2)
})

test('LEDGER_NOT_FOUND만 공통 경계를 알리고 로컬 처리와 일반 404는 제외한다', async () => {
  const originalFetch = globalThis.fetch
  let notices = 0
  const unsubscribe = subscribeLedgerNotFound(() => { notices += 1 })

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: '가계부 없음', errorCode: 'LEDGER_NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/problem+json' } })
    await assert.rejects(api('/api/assets'))
    assert.equal(notices, 1)

    await assert.rejects(api('/api/ledger-books/current', {}, { notifyLedgerNotFound: false }))
    assert.equal(notices, 1)

    globalThis.fetch = async () => new Response(JSON.stringify({ detail: '자산 없음', errorCode: 'ASSET_NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/problem+json' } })
    await assert.rejects(api('/api/assets/asset-1'))
    assert.equal(notices, 1)

    globalThis.fetch = async () => new Response(JSON.stringify({ detail: '잘못된 상태 코드', errorCode: 'LEDGER_NOT_FOUND' }), { status: 409, headers: { 'Content-Type': 'application/problem+json' } })
    await assert.rejects(api('/api/assets'))
    assert.equal(notices, 1)
  } finally {
    unsubscribe()
    globalThis.fetch = originalFetch
  }
})
