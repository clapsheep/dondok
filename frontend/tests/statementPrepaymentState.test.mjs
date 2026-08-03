import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptStatementPrepaymentPreview,
  changeStatementPrepaymentAmount,
  createStatementPrepaymentWorkflow,
  markStatementPrepaymentConflict,
  parseStatementPrepaymentAmount,
  rebaseStatementPrepaymentWorkflow,
  validateStatementPrepaymentDraft,
} from '../src/features/card-statements/prepaymentState.ts'

const statement = { statementId: 'statement-1', version: 3, remainingAmountWon: 100_000, prepayableAmountWon: 100_000 }

test('남은 결제 금액 안에서 전액과 부분 선결제를 허용한다', () => {
  assert.deepEqual(parseStatementPrepaymentAmount('30,000', statement.remainingAmountWon), { amountWon: 30_000 })
  assert.deepEqual(parseStatementPrepaymentAmount('100000', statement.remainingAmountWon), { amountWon: 100_000 })
})

test('남은 결제 금액을 넘는 선결제는 확인 전에 막는다', () => {
  assert.deepEqual(parseStatementPrepaymentAmount('100001', statement.remainingAmountWon), {
    error: '남은 결제 금액 100,000원 이하로 입력해 주세요.',
  })
})

test('금액을 바꾸면 이전 preview를 폐기한다', () => {
  const initial = createStatementPrepaymentWorkflow(statement)
  const previewed = acceptStatementPrepaymentPreview(initial, { previewToken: 'preview-1' }, 3)
  const changed = changeStatementPrepaymentAmount(previewed, '20000')

  assert.equal(changed.draft.amountWon, '20000')
  assert.equal(changed.preview, undefined)
})

test('412 충돌은 draft를 보존하고 preview만 폐기한 뒤 명시적 재계산을 요구한다', () => {
  const initial = changeStatementPrepaymentAmount(createStatementPrepaymentWorkflow(statement), '30000')
  const previewed = acceptStatementPrepaymentPreview(initial, { previewToken: 'preview-1' }, 3)
  const conflicted = markStatementPrepaymentConflict(previewed, {
    statementId: statement.statementId,
    version: 4,
    remainingAmountWon: 70_000,
    prepayableAmountWon: 70_000,
  })

  assert.equal(conflicted.draft.amountWon, '30000')
  assert.equal(conflicted.preview, undefined)
  assert.equal(conflicted.baseVersion, 3)
  assert.equal(conflicted.conflict?.version, 4)

  const rebased = rebaseStatementPrepaymentWorkflow(conflicted)
  assert.equal(rebased.draft.amountWon, '30000')
  assert.equal(rebased.baseVersion, 4)
  assert.equal(rebased.conflict, undefined)
})

test('첫 선결제 적용 후 최신 잔액으로 새 workflow를 만들면 추가 선결제를 다시 받을 수 있다', () => {
  const afterFirstPayment = { ...statement, version: 4, remainingAmountWon: 70_000, prepayableAmountWon: 70_000 }
  const next = changeStatementPrepaymentAmount(createStatementPrepaymentWorkflow(afterFirstPayment), '20000')

  assert.deepEqual(parseStatementPrepaymentAmount(next.draft.amountWon, afterFirstPayment.remainingAmountWon), { amountWon: 20_000 })
  assert.equal(next.baseVersion, 4)
  assert.equal(next.preview, undefined)
})

test('최신 남은 금액을 전액 기본값으로 제안한다', () => {
  const initial = createStatementPrepaymentWorkflow(statement)
  assert.deepEqual(initial.draft, { amountWon: '100000' })
})

test('금액 draft를 preview request 값으로 검증한다', () => {
  assert.deepEqual(validateStatementPrepaymentDraft({ amountWon: '30000' }, statement.remainingAmountWon), {
    amountWon: 30_000,
    errors: { amountWon: undefined },
  })
})
