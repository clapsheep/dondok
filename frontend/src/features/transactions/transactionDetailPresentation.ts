import type { Transaction } from './api'
import { formatWon } from '../assets/format.ts'
import { transferPurposeLabels } from './transferPurpose.ts'

export function transactionReflection(transaction: Transaction) {
  const transfer = transaction.type === 'TRANSFER'
  const purpose = transaction.transferPurpose
  const formation = transfer && purpose && purpose !== 'GENERAL'
  const refund = transaction.managementType === 'CARD_REFUND'
  const representative = !refund && transaction.type === 'EXPENSE' && transaction.statisticsAmountWon !== transaction.amountWon
  const label = transfer ? formation ? `${transferPurposeLabels[purpose]}에 반영` : '수입·지출에 미포함' : refund ? '지출에서 차감' : transaction.type === 'INCOME' ? '수입에 반영' : '지출에 반영'
  const amount = transfer ? formation ? transaction.amountWon : 0 : transaction.excludedFromStatistics ? 0 : transaction.statisticsAmountWon
  const note = transfer ? formation ? '수입·생활 지출에 중복 집계하지 않고, 통계의 자산 형성에 표시해요.' : '자산 사이의 이동이에요. 달력·통계의 수입·지출 합계에는 다시 더하지 않아요.'
    : transaction.excludedFromStatistics ? '자산에는 거래 금액이 반영되고, 달력·통계의 수입·지출 합계에서는 제외돼요.'
    : refund ? '환불 날짜의 지출에서 차감해요. 실제 반환 내역은 원 카드 구매에서 확인할 수 있어요.'
    : representative ? `실제 결제한 ${formatWon(transaction.amountWon)} 중 내 부담액만 달력·통계의 지출로 남아요.`
    : transaction.managementType === 'CARD_PURCHASE' ? '구매한 날짜의 지출이에요. 나중에 카드 대금을 결제해도 다시 집계하지 않아요.'
    : `선택한 날짜의 달력과 통계에 ${transaction.type === 'INCOME' ? '수입으로' : '지출로'} 반영돼요.`
  return { label, amount, note, representative }
}
