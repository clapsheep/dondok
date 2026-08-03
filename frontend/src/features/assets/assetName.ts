const MAX_ASSET_NAME_LENGTH = 100

export type ExistingAssetName = {
  assetId: string
  name: string
}

type ResolveAssetNameOptions = {
  draftName: string
  typeName: string
  assets: readonly ExistingAssetName[]
  excludedAssetId?: string
}

export function normalizeAssetName(name: string) {
  return name.trim().toLocaleLowerCase('ko-KR')
}

export function resolveAssetName({
  draftName,
  typeName,
  assets,
  excludedAssetId,
}: ResolveAssetNameOptions) {
  const explicitName = draftName.trim()
  if (explicitName) return explicitName

  const preferredName = typeName.trim().slice(0, MAX_ASSET_NAME_LENGTH)
  if (!preferredName) return ''

  const usedNames = new Set(
    assets
      .filter((asset) => asset.assetId !== excludedAssetId)
      .map((asset) => normalizeAssetName(asset.name)),
  )
  if (!usedNames.has(normalizeAssetName(preferredName))) return preferredName

  for (let suffixNumber = 2; ; suffixNumber += 1) {
    const suffix = ` ${suffixNumber}`
    const stem = preferredName.slice(0, MAX_ASSET_NAME_LENGTH - suffix.length).trimEnd()
    const candidate = `${stem}${suffix}`
    if (!usedNames.has(normalizeAssetName(candidate))) return candidate
  }
}
