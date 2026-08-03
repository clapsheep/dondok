import type { Asset } from '../assets/api'

export function transferAccountAssets<T extends Pick<Asset, 'systemCode'>>(
  assets: readonly T[],
): T[] {
  return assets.filter((asset) => asset.systemCode === 'BANK')
}
