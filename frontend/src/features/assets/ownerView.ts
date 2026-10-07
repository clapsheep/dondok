import type { LedgerMember } from '../membership/api'
import type { Asset } from './api'

export const ALL_ASSET_OWNER_VIEW = 'all'
const MEMBER_ASSET_OWNER_VIEW_PREFIX = 'member:'

export type AssetOwnerView = {
  key: string
  label: string
}

type OwnedAsset = Pick<Asset, 'ownershipScope' | 'ownerMemberId'>

export function buildAssetOwnerViews(members: readonly LedgerMember[]): AssetOwnerView[] {
  return [
    { key: ALL_ASSET_OWNER_VIEW, label: '전체' },
    ...members.map((member) => ({
      key: `${MEMBER_ASSET_OWNER_VIEW_PREFIX}${member.memberId}`,
      label: member.currentUser ? `${member.displayName} (나)` : member.displayName,
    })),
  ]
}

export function defaultAssetOwnerViewKey(members: readonly LedgerMember[]): string {
  const currentMember = members.find((member) => member.currentUser)
  return currentMember ? `${MEMBER_ASSET_OWNER_VIEW_PREFIX}${currentMember.memberId}` : ALL_ASSET_OWNER_VIEW
}

export function resolveAssetOwnerView(
  requestedKey: string | null,
  views: readonly AssetOwnerView[],
  defaultKey = ALL_ASSET_OWNER_VIEW,
): AssetOwnerView {
  return views.find((view) => view.key === requestedKey)
    ?? views.find((view) => view.key === defaultKey)
    ?? views[0]
}

export function filterAssetsByOwner<T extends OwnedAsset>(assets: readonly T[], ownerViewKey: string): T[] {
  if (ownerViewKey === ALL_ASSET_OWNER_VIEW) return [...assets]

  const memberId = ownerViewKey.startsWith(MEMBER_ASSET_OWNER_VIEW_PREFIX)
    ? ownerViewKey.slice(MEMBER_ASSET_OWNER_VIEW_PREFIX.length)
    : null
  if (!memberId) return [...assets]

  return assets.filter((asset) => asset.ownerMemberId === memberId)
}
