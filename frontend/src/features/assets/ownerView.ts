import type { LedgerMember } from '../membership/api'
import type { Asset } from './api'

export const ALL_ASSET_OWNER_VIEW = 'all'
export const JOINT_ASSET_OWNER_VIEW = 'joint'
const MEMBER_ASSET_OWNER_VIEW_PREFIX = 'member:'

export type AssetOwnerView = {
  key: string
  label: string
}

type OwnedAsset = Pick<Asset, 'ownershipScope' | 'ownerMemberId'>

export function buildAssetOwnerViews(members: readonly LedgerMember[]): AssetOwnerView[] {
  return [
    { key: ALL_ASSET_OWNER_VIEW, label: '전체' },
    { key: JOINT_ASSET_OWNER_VIEW, label: '공동 소유' },
    ...members.map((member) => ({
      key: `${MEMBER_ASSET_OWNER_VIEW_PREFIX}${member.memberId}`,
      label: member.currentUser ? `${member.displayName} (나)` : member.displayName,
    })),
  ]
}

export function resolveAssetOwnerView(requestedKey: string | null, views: readonly AssetOwnerView[]): AssetOwnerView {
  return views.find((view) => view.key === requestedKey) ?? views[0]
}

export function filterAssetsByOwner<T extends OwnedAsset>(assets: readonly T[], ownerViewKey: string): T[] {
  if (ownerViewKey === ALL_ASSET_OWNER_VIEW) return [...assets]
  if (ownerViewKey === JOINT_ASSET_OWNER_VIEW) return assets.filter((asset) => asset.ownershipScope === 'JOINT')

  const memberId = ownerViewKey.startsWith(MEMBER_ASSET_OWNER_VIEW_PREFIX)
    ? ownerViewKey.slice(MEMBER_ASSET_OWNER_VIEW_PREFIX.length)
    : null
  if (!memberId) return [...assets]

  return assets.filter((asset) => asset.ownershipScope === 'PERSONAL' && asset.ownerMemberId === memberId)
}
