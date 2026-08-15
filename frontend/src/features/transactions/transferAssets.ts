import type { Asset } from '../assets/api'
import type { LedgerMember } from '../membership/api'

export function transferEligibleAssets<T extends Pick<Asset, 'systemCode'>>(
  assets: readonly T[],
): T[] {
  return assets.filter((asset) => asset.systemCode === 'BANK' || asset.systemCode === 'SAVINGS')
}

type OwnedTransferAccount = Pick<Asset, 'name' | 'ownershipScope' | 'ownerMemberId'>
type TransferMember = Pick<LedgerMember, 'memberId' | 'displayName' | 'currentUser'>

export function transferAssetLabel(
  asset: OwnedTransferAccount,
  members: readonly TransferMember[],
): string {
  if (asset.ownershipScope === 'JOINT') return `${asset.name} · 공동`

  const owner = members.find((member) => member.memberId === asset.ownerMemberId)
  if (!owner) return `${asset.name} · 구성원`
  return `${asset.name} · ${owner.currentUser ? '나' : owner.displayName}`
}
