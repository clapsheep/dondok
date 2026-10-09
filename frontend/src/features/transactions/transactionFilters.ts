import type { TransactionFilters } from './api'

export function readTransactionFilters(params: URLSearchParams): TransactionFilters {
  const type = params.get('type')
  const member = params.get('performedByMemberId') ?? ''
  const date = (key: string) => {
    const value = params.get(key) ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined
  }
  return {
    q: params.get('q')?.trim().slice(0, 100) || undefined,
    from: date('from'), toExclusive: date('toExclusive'),
    type: type === 'INCOME' || type === 'EXPENSE' || type === 'TRANSFER' ? type : undefined,
    performedByMemberId: /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(member) ? member : undefined,
  }
}

export function writeTransactionFilters(previous: URLSearchParams, next: TransactionFilters) {
  const params = new URLSearchParams(previous)
  for (const key of ['q', 'from', 'toExclusive', 'type', 'performedByMemberId'] as const) {
    if (next[key]) params.set(key, next[key])
    else params.delete(key)
  }
  return params
}
