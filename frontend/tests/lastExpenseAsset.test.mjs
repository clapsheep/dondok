import assert from 'node:assert/strict'
import test from 'node:test'
import { readLastExpenseAssetId, rememberLastExpenseAsset } from '../src/features/transactions/lastExpenseAsset.ts'

function memoryStorage() {
  let value = null
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next },
  }
}

test('사용자와 가계부별 마지막 지출 자산을 다시 선택한다', () => {
  const storage = memoryStorage()
  rememberLastExpenseAsset(storage, { ledgerId: 'ledger-a', memberId: 'member-a', assetId: 'bank-a' })
  assert.equal(readLastExpenseAssetId(storage, {
    ledgerId: 'ledger-a',
    memberId: 'member-a',
    activeAssetIds: ['cash-a', 'bank-a'],
  }), 'bank-a')
})

test('다른 사용자 값이나 보관되어 목록에서 사라진 자산은 기본 선택에 사용하지 않는다', () => {
  const storage = memoryStorage()
  rememberLastExpenseAsset(storage, { ledgerId: 'ledger-a', memberId: 'member-a', assetId: 'bank-a' })
  assert.equal(readLastExpenseAssetId(storage, {
    ledgerId: 'ledger-a',
    memberId: 'member-b',
    activeAssetIds: ['bank-a'],
  }), '')
  assert.equal(readLastExpenseAssetId(storage, {
    ledgerId: 'ledger-a',
    memberId: 'member-a',
    activeAssetIds: ['cash-a'],
  }), '')

  rememberLastExpenseAsset(storage, { ledgerId: 'ledger-a', memberId: 'member-b', assetId: 'cash-b' })
  assert.equal(readLastExpenseAssetId(storage, {
    ledgerId: 'ledger-a',
    memberId: 'member-a',
    activeAssetIds: ['bank-a'],
  }), 'bank-a')
})

test('손상된 브라우저 선호값은 거래 입력을 막지 않는다', () => {
  const storage = { getItem: () => '{broken', setItem: () => undefined }
  assert.equal(readLastExpenseAssetId(storage, {
    ledgerId: 'ledger-a',
    memberId: 'member-a',
    activeAssetIds: ['cash-a'],
  }), '')
})
