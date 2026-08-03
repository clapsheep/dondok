import type { Asset, AssetTypeSystemCode } from './api'

export type AssetGroupKey = 'liquid' | 'cards' | 'investments' | 'loans' | 'insurance'

export type BalanceSummary = {
  assetsWon: number
  liabilitiesWon: number
  netWon: number
}

export type AssetGroupSummary = BalanceSummary & {
  key: AssetGroupKey
  label: string
  items: Asset[]
  currentMonthCardPaymentDueWon: number
  nextMonthCardPaymentDueWon: number
}

export type AssetOverview = BalanceSummary & {
  currentMonthCardPaymentDueWon: number
  nextMonthCardPaymentDueWon: number
  groups: AssetGroupSummary[]
}

export type AssetStatusOverview = {
  summary: AssetOverview
  active: AssetOverview
  activeAssets: Asset[]
  archivedAssets: Asset[]
}

const groupDefinitions: { key: AssetGroupKey; label: string; systemCodes: readonly AssetTypeSystemCode[] }[] = [
  { key: 'liquid', label: '자금', systemCodes: ['CASH', 'OTHER', 'BANK', 'SAVINGS', 'OVERDRAFT'] },
  { key: 'cards', label: '카드', systemCodes: ['CREDIT_CARD', 'DEBIT_CARD'] },
  { key: 'investments', label: '투자', systemCodes: ['INVESTMENT'] },
  { key: 'loans', label: '대출', systemCodes: ['LOAN'] },
  { key: 'insurance', label: '보험', systemCodes: ['INSURANCE'] },
]

const groupBySystemCode = new Map(groupDefinitions.flatMap((group) => group.systemCodes.map((systemCode) => [systemCode, group] as const)))

export function buildAssetOverview(assets: readonly Asset[]): AssetOverview {
  const groups = new Map<AssetGroupKey, AssetGroupSummary>()
  let assetsWon = 0
  let liabilitiesWon = 0
  let netWon = 0
  let currentMonthCardPaymentDueWon = 0
  let nextMonthCardPaymentDueWon = 0

  for (const asset of assets) {
    if (asset.currentBalanceWon > 0) assetsWon += asset.currentBalanceWon
    else if (asset.currentBalanceWon < 0) liabilitiesWon += Math.abs(asset.currentBalanceWon)
    netWon += asset.currentBalanceWon
    currentMonthCardPaymentDueWon += asset.currentMonthCardPaymentDueWon
    nextMonthCardPaymentDueWon += asset.nextMonthCardPaymentDueWon

    const definition = groupBySystemCode.get(asset.systemCode)
    if (!definition) continue
    const group = groups.get(definition.key) ?? {
      key: definition.key,
      label: definition.label,
      items: [],
      assetsWon: 0,
      liabilitiesWon: 0,
      netWon: 0,
      currentMonthCardPaymentDueWon: 0,
      nextMonthCardPaymentDueWon: 0,
    }
    addBalance(group, asset.currentBalanceWon)
    group.currentMonthCardPaymentDueWon += asset.currentMonthCardPaymentDueWon
    group.nextMonthCardPaymentDueWon += asset.nextMonthCardPaymentDueWon
    group.items.push(asset)
    groups.set(definition.key, group)
  }

  return {
    assetsWon,
    liabilitiesWon,
    netWon,
    currentMonthCardPaymentDueWon,
    nextMonthCardPaymentDueWon,
    groups: groupDefinitions.flatMap((definition) => {
      const group = groups.get(definition.key)
      return group ? [group] : []
    }),
  }
}

export function buildAssetStatusOverview(assets: readonly Asset[]): AssetStatusOverview {
  const activeAssets: Asset[] = []
  const archivedAssets: Asset[] = []
  for (const asset of assets) {
    if (asset.status === 'ARCHIVED') archivedAssets.push(asset)
    else activeAssets.push(asset)
  }
  return {
    summary: buildAssetOverview(assets),
    active: buildAssetOverview(activeAssets),
    activeAssets,
    archivedAssets,
  }
}

function addBalance(summary: BalanceSummary, balanceWon: number) {
  if (balanceWon > 0) summary.assetsWon += balanceWon
  else if (balanceWon < 0) summary.liabilitiesWon += Math.abs(balanceWon)
  summary.netWon += balanceWon
}
