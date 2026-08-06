import type { Asset } from '../assets/api'
import type { LedgerMember } from '../membership/api'

export function transferAccountAssets<T extends Pick<Asset, 'systemCode'>>(
  assets: readonly T[],
): T[] {
  return assets.filter((asset) => asset.systemCode === 'BANK')
}

type OwnedTransferAccount = Pick<Asset, 'name' | 'ownershipScope' | 'ownerMemberId'>
type TransferMember = Pick<LedgerMember, 'memberId' | 'displayName' | 'currentUser'>

export function transferAccountLabel(
  asset: OwnedTransferAccount,
  members: readonly TransferMember[],
): string {
  if (asset.ownershipScope === 'JOINT') return `${asset.name} · 공동`

  const owner = members.find((member) => member.memberId === asset.ownerMemberId)
  if (!owner) return `${asset.name} · 구성원`
  return `${asset.name} · ${owner.currentUser ? '나' : owner.displayName}`
}
