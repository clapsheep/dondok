import { Banknote, ChartNoAxesCombined, CircleEllipsis, CreditCard, HandCoins, Landmark, PiggyBank, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { AssetTypeSystemCode } from './api'

const icons: Record<AssetTypeSystemCode, LucideIcon> = {
  CASH: Banknote, BANK: Landmark, CREDIT_CARD: CreditCard, DEBIT_CARD: CreditCard,
  SAVINGS: PiggyBank, INVESTMENT: ChartNoAxesCombined, LOAN: HandCoins,
  INSURANCE: ShieldCheck, OTHER: CircleEllipsis,
}

export function AssetIcon({ systemCode, size = 20 }: { systemCode: AssetTypeSystemCode; size?: number }) {
  const Icon = icons[systemCode]
  return <Icon size={size} className="shrink-0 text-[var(--muted)]" aria-hidden="true" data-asset-icon={systemCode}/>
}
