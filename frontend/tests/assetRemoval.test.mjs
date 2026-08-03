import assert from 'node:assert/strict'
import test from 'node:test'
import { blockingLinkKindLabel, removalDescription, removalWarnings } from '../src/features/assets/removal.ts'

test('서버가 DELETE를 결정하면 완전 삭제와 복구 불가를 안내한다', () => {
  assert.match(removalDescription('DELETE'), /완전히 삭제/)
  assert.match(removalDescription('DELETE'), /되돌릴 수 없/)
})

test('서버가 ARCHIVE를 결정하면 기록 유지와 신규 선택 제외를 안내한다', () => {
  assert.match(removalDescription('ARCHIVE'), /기록과 잔액을 유지/)
  assert.match(removalDescription('ARCHIVE'), /새 거래나 연결 계좌에서 선택할 수 없/)
})

test('보관 잔액과 미결제 명세는 차단이 아닌 경고로 함께 만든다', () => {
  assert.deepEqual(removalWarnings({ disposition: 'ARCHIVE', currentBalanceWon: -50_000, unpaidCardStatementCount: 2 }), [
    '현재 잔액은 보관 후에도 순자산에 계속 포함돼요.',
    '미결제 카드 명세 2건은 보관 후에도 기존 결제 흐름을 계속해요.',
  ])
  assert.deepEqual(removalWarnings({ disposition: 'DELETE', currentBalanceWon: 0, unpaidCardStatementCount: 0 }), [])
})

test('차단 연결 종류를 사용자가 바꿀 설정 이름으로 표시한다', () => {
  assert.equal(blockingLinkKindLabel('CREDIT_CARD_SETTLEMENT'), '신용카드 결제 계좌')
  assert.equal(blockingLinkKindLabel('DEBIT_CARD_PAYMENT'), '체크카드 결제 계좌')
  assert.equal(blockingLinkKindLabel('SAVINGS_TRANSFER'), '적금 자동이체 계좌')
  assert.equal(blockingLinkKindLabel('CARD_PAYMENT_SCHEDULE'), '카드 결제 일정')
})
