type Scope = { ledgerId: string; memberId: string }
type StorageProvider = () => Pick<Storage, 'getItem' | 'setItem'>

const browserStorage: StorageProvider = () => window.localStorage

function storageKey({ ledgerId, memberId }: Scope) {
  return `dondok-last-transaction-date-v1:${ledgerId}:${memberId}`
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function readLastTransactionDate(scope: Scope, storage: StorageProvider = browserStorage): string | undefined {
  if (!scope.ledgerId || !scope.memberId) return undefined
  try {
    const value = storage().getItem(storageKey(scope))
    return validDate(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function rememberLastTransactionDate(scope: Scope, occurredOn: string, storage: StorageProvider = browserStorage) {
  if (!scope.ledgerId || !scope.memberId || !validDate(occurredOn)) return
  try {
    // Scope마다 별도 key를 사용해 다른 구성원·탭의 값을 덮어쓰지 않는다.
    storage().setItem(storageKey(scope), occurredOn)
  } catch {
    // 선호값 저장 실패가 이미 성공한 거래 저장과 화면 이동을 막지 않는다.
  }
}
