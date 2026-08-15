import type { Asset } from './api'

const wonFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

type AssetPickerAmount = Pick<
  Asset,
  'behavior' | 'currentBalanceWon' | 'currentMonthCardPaymentDueWon' | 'nextMonthCardPaymentDueWon'
>

export function assetPickerAmountLabel(asset: AssetPickerAmount) {
  if (asset.behavior !== 'CREDIT_CARD') return `잔액 ${formatWon(asset.currentBalanceWon)}`
  const nearestPaymentDueWon = asset.currentMonthCardPaymentDueWon > 0
    ? asset.currentMonthCardPaymentDueWon
    : Math.max(0, asset.nextMonthCardPaymentDueWon)
  return `결제 예정 ${formatWon(nearestPaymentDueWon)}`
}

function formatWon(value: number) {
  return `${wonFormat.format(value)}원`
}
