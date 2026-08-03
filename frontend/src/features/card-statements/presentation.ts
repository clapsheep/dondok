import type { CardPaymentScheduleStatus, CardStatementPaymentType, CardStatementStatus, CardStatementSummary } from './api'

export function cardStatementStatusLabel(status: CardStatementStatus) {
  return {
    OPEN: '결제 예정',
    FINALIZED: '결제 금액 확정',
    PAID: '결제 완료',
    CANCELLED: '취소',
  }[status]
}

export function cardPaymentScheduleStatusLabel(status: CardPaymentScheduleStatus) {
  return {
    SCHEDULED: '자동 정산 예정',
    PROCESSING: '자동 정산 처리 중',
    COMPLETED: '자동 정산 완료',
    FAILED: '자동 정산 재시도 대기',
    CANCELLED: '자동 정산 취소',
  }[status]
}

export function cardStatementPaymentTypeLabel(type: CardStatementPaymentType) {
  return type === 'PREPAYMENT' ? '선결제' : '정기 결제'
}

export function sortCardStatementsForDisplay(statements: CardStatementSummary[]) {
  return [...statements].sort((left, right) => {
    const leftUnpaid = left.status === 'OPEN' || left.status === 'FINALIZED'
    const rightUnpaid = right.status === 'OPEN' || right.status === 'FINALIZED'
    if (leftUnpaid !== rightUnpaid) return leftUnpaid ? -1 : 1
    return leftUnpaid
      ? left.dueOn.localeCompare(right.dueOn) || left.statementId.localeCompare(right.statementId)
      : right.dueOn.localeCompare(left.dueOn) || right.statementId.localeCompare(left.statementId)
  })
}
