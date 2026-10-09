import assert from 'node:assert/strict'
import test from 'node:test'
import { readLastTransactionDate, rememberLastTransactionDate } from '../src/features/transactions/lastTransactionDate.ts'

const scope = { ledgerId: 'ledger-a', memberId: 'member-a' }
function memoryStorage() {
  const values = new Map()
  return () => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) })
}

test('날짜 최댓값이 아니라 마지막으로 저장한 거래일을 기억한다', () => {
  const storage = memoryStorage()
  assert.equal(readLastTransactionDate(scope, storage), undefined)
  rememberLastTransactionDate(scope, '2026-10-08', storage)
  rememberLastTransactionDate(scope, '2026-09-20', storage)
  assert.equal(readLastTransactionDate(scope, storage), '2026-09-20')
})

test('입력자와 가계부별 키를 분리하고 다른 범위를 덮어쓰지 않는다', () => {
  const storage = memoryStorage()
  const otherMember = { ...scope, memberId: 'member-b' }
  const otherLedger = { ...scope, ledgerId: 'ledger-b' }
  rememberLastTransactionDate(scope, '2026-10-08', storage)
  assert.equal(readLastTransactionDate(otherMember, storage), undefined)
  assert.equal(readLastTransactionDate(otherLedger, storage), undefined)
  rememberLastTransactionDate(otherMember, '2026-08-01', storage)
  rememberLastTransactionDate(otherLedger, '2026-09-01', storage)
  assert.equal(readLastTransactionDate(scope, storage), '2026-10-08')
  assert.equal(readLastTransactionDate(otherMember, storage), '2026-08-01')
  assert.equal(readLastTransactionDate(otherLedger, storage), '2026-09-01')
})

test('손상된 값과 실제로 존재하지 않는 날짜는 무시하고 윤년은 허용한다', () => {
  for (const value of ['broken', '2026-2-1', '2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026-01-00']) {
    const storage = () => ({ getItem: () => value, setItem: () => assert.fail('유효하지 않은 날짜 저장') })
    assert.equal(readLastTransactionDate(scope, storage), undefined)
    rememberLastTransactionDate(scope, value, storage)
  }
  const storage = memoryStorage()
  rememberLastTransactionDate(scope, '2024-02-29', storage)
  assert.equal(readLastTransactionDate(scope, storage), '2024-02-29')
})

test('저장소 객체 접근·읽기·쓰기 실패가 입력과 저장 완료를 막지 않는다', () => {
  const fail = () => { throw new Error('Storage unavailable') }
  for (const storage of [fail, () => ({ getItem: fail, setItem: fail })]) {
    assert.equal(readLastTransactionDate(scope, storage), undefined)
    assert.doesNotThrow(() => rememberLastTransactionDate(scope, '2026-10-08', storage))
  }
})

test('현재 입력자 또는 가계부를 확인할 수 없으면 저장소를 사용하지 않는다', () => {
  const storage = () => assert.fail('범위 없는 저장소 접근')
  for (const missing of [{ ...scope, memberId: '' }, { ...scope, ledgerId: '' }]) {
    assert.equal(readLastTransactionDate(missing, storage), undefined)
    rememberLastTransactionDate(missing, '2026-10-08', storage)
  }
})
