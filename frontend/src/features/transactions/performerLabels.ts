import type { TransactionType } from './api'

export function performerQuestionLabel(type: TransactionType) {
  if (type === 'INCOME') return '누가 받았나요?'
  if (type === 'EXPENSE') return '누가 썼나요?'
  return '누가 옮겼나요?'
}

export function performerPersonLabel(type: TransactionType) {
  if (type === 'INCOME') return '받은 사람'
  if (type === 'EXPENSE') return '쓴 사람'
  return '옮긴 사람'
}

export function performerSelectionError(type: TransactionType) {
  if (type === 'INCOME') return '누가 받았는지 선택해 주세요.'
  if (type === 'EXPENSE') return '누가 썼는지 선택해 주세요.'
  return '누가 옮겼는지 선택해 주세요.'
}
