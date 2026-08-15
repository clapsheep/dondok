import type { Asset, AssetTypeSystemCode } from './api'
import { financialInstitutionSortOrder } from './financialInstitutions.ts'
import { cardIssuerSortOrder } from './cardIssuers.ts'

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
  nearestCardPaymentDueWon: number
  followingCardPaymentDueWon: number
}

export type AssetOverview = BalanceSummary & {
  nearestCardPaymentDueWon: number
  followingCardPaymentDueWon: number
  groups: AssetGroupSummary[]
}

export type AssetStatusOverview = {
  summary: AssetOverview
  active: AssetOverview
  activeAssets: Asset[]
  archivedAssets: Asset[]
}

const groupDefinitions: { key: AssetGroupKey; label: string; systemCodes: readonly AssetTypeSystemCode[] }[] = [
  { key: 'liquid', label: '자금', systemCodes: ['CASH', 'OTHER', 'BANK', 'SAVINGS'] },
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
  let nearestCardPaymentDueWon = 0
  let followingCardPaymentDueWon = 0

  for (const asset of assets) {
    if (asset.currentBalanceWon > 0) assetsWon += asset.currentBalanceWon
    else if (asset.currentBalanceWon < 0) liabilitiesWon += Math.abs(asset.currentBalanceWon)
    netWon += asset.currentBalanceWon
    nearestCardPaymentDueWon += asset.nearestCardPaymentDueWon
    followingCardPaymentDueWon += asset.followingCardPaymentDueWon

    const definition = groupBySystemCode.get(asset.systemCode)
    if (!definition) continue
    const group = groups.get(definition.key) ?? {
      key: definition.key,
      label: definition.label,
      items: [],
      assetsWon: 0,
      liabilitiesWon: 0,
      netWon: 0,
      nearestCardPaymentDueWon: 0,
      followingCardPaymentDueWon: 0,
    }
    addBalance(group, asset.currentBalanceWon)
    group.nearestCardPaymentDueWon += asset.nearestCardPaymentDueWon
    group.followingCardPaymentDueWon += asset.followingCardPaymentDueWon
    group.items.push(asset)
    groups.set(definition.key, group)
  }

  return {
    assetsWon,
    liabilitiesWon,
    netWon,
    nearestCardPaymentDueWon,
    followingCardPaymentDueWon,
    groups: groupDefinitions.flatMap((definition) => {
      const group = groups.get(definition.key)
      if (!group) return []
      group.items.sort(compareAssetsForOverview)
      return [group]
    }),
  }
}

function compareAssetsForOverview(left: Asset, right: Asset) {
  const leftBankRelated = left.systemCode === 'BANK' || left.systemCode === 'SAVINGS'
  const rightBankRelated = right.systemCode === 'BANK' || right.systemCode === 'SAVINGS'
  if (leftBankRelated !== rightBankRelated) return leftBankRelated ? 1 : -1
  if ((leftBankRelated && rightBankRelated)
    || (left.systemCode === right.systemCode && (left.systemCode === 'LOAN' || left.systemCode === 'INVESTMENT'))) {
    const institutionOrder = financialInstitutionSortOrder(left.financialInstitutionCode)
      - financialInstitutionSortOrder(right.financialInstitutionCode)
    if (institutionOrder !== 0) return institutionOrder
  }
  const leftCardRelated = left.systemCode === 'CREDIT_CARD' || left.systemCode === 'DEBIT_CARD'
  const rightCardRelated = right.systemCode === 'CREDIT_CARD' || right.systemCode === 'DEBIT_CARD'
  if (leftCardRelated && rightCardRelated) {
    const issuerOrder = cardIssuerSortOrder(left.cardIssuerCode) - cardIssuerSortOrder(right.cardIssuerCode)
    if (issuerOrder !== 0) return issuerOrder
  }
  const typeOrder = (left.assetTypeName ?? left.systemCode).localeCompare(right.assetTypeName ?? right.systemCode, 'ko')
  return typeOrder
    || (left.name ?? '').localeCompare(right.name ?? '', 'ko')
    || (left.assetId ?? '').localeCompare(right.assetId ?? '')
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
