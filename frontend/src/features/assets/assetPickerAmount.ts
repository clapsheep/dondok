import type { Asset } from './api'

const wonFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

type AssetPickerAmount = Pick<
  Asset,
  'behavior' | 'currentBalanceWon' | 'nearestCardPaymentDueWon'
>

export function assetPickerAmountLabel(asset: AssetPickerAmount) {
  if (asset.behavior !== 'CREDIT_CARD') return `잔액 ${formatWon(asset.currentBalanceWon)}`
  return `결제 예정 ${formatWon(Math.max(0, asset.nearestCardPaymentDueWon))}`
}

function formatWon(value: number) {
  return `${wonFormat.format(value)}원`
}
