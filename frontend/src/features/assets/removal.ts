import type { AssetRemovalBlockingLinkKind, AssetRemovalDisposition, AssetRemovalPreview } from './api'

export function removalTitle(disposition: AssetRemovalDisposition) {
  return disposition === 'DELETE' ? '자산 완전 삭제' : '자산 사용 종료'
}

export function removalActionLabel(disposition: AssetRemovalDisposition) {
  return disposition === 'DELETE' ? '자산 완전 삭제' : '자산 사용 종료'
}

export function removalDescription(disposition: AssetRemovalDisposition) {
  return disposition === 'DELETE'
    ? '거래 이력이 없어 이 자산을 완전히 삭제합니다. 삭제한 자산은 되돌릴 수 없어요.'
    : '거래 이력이 있어 완전히 지우지 않고 사용만 종료합니다. 과거 기록과 잔액은 유지되고 새 거래에서는 숨겨지며, 필요하면 다시 사용할 수 있어요.'
}

export function removalWarnings(preview: Pick<AssetRemovalPreview, 'disposition' | 'currentBalanceWon' | 'unpaidCardStatementCount'>) {
  const warnings: string[] = []
  if (preview.disposition === 'ARCHIVE' && preview.currentBalanceWon !== 0) warnings.push('현재 잔액은 사용 종료 후에도 순자산에 계속 포함돼요.')
  if (preview.unpaidCardStatementCount > 0) warnings.push(`미결제 카드 명세 ${preview.unpaidCardStatementCount}건은 남지만 예약 결제와 새 선결제는 중단돼요.`)
  return warnings
}

export function blockingLinkKindLabel(kind: AssetRemovalBlockingLinkKind) {
  if (kind === 'CREDIT_CARD_SETTLEMENT') return '신용카드 결제 계좌'
  if (kind === 'DEBIT_CARD_PAYMENT') return '체크카드 결제 계좌'
  if (kind === 'SAVINGS_TRANSFER') return '적금 자동이체 계좌'
  return '카드 결제 일정'
}
