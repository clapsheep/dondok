const STORAGE_KEY = 'dondok-last-expense-asset-v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type LastExpenseAsset = { ledgerId: string; memberId: string; assetId: string }
type LastExpenseAssets = { byScope: Record<string, string> }

function scopeKey(ledgerId: string, memberId: string) {
  return `${ledgerId}:${memberId}`
}

export function readLastExpenseAssetId(storage: StorageLike, scope: { ledgerId: string; memberId: string; activeAssetIds: string[] }) {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return ''
    const stored = JSON.parse(raw) as Partial<LastExpenseAssets>
    const assetId = stored.byScope?.[scopeKey(scope.ledgerId, scope.memberId)]
    return typeof assetId === 'string' && scope.activeAssetIds.includes(assetId) ? assetId : ''
  } catch {
    return ''
  }
}

export function rememberLastExpenseAsset(storage: StorageLike, value: LastExpenseAsset) {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) as Partial<LastExpenseAssets> : undefined
    const byScope = stored?.byScope && typeof stored.byScope === 'object' ? stored.byScope : {}
    storage.setItem(STORAGE_KEY, JSON.stringify({
      byScope: { ...byScope, [scopeKey(value.ledgerId, value.memberId)]: value.assetId },
    } satisfies LastExpenseAssets))
  } catch {
    // 브라우저가 저장소를 차단해도 거래 저장 자체는 성공해야 한다.
  }
}
