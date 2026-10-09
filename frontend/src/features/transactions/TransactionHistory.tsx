import { Fragment, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import type { LedgerMember } from '../membership/api'
import type { TransactionFilters } from './api'
import { TransactionHistoryTools } from './TransactionHistoryTools'
import { TransactionDateGroup } from './TransactionDateGroup'

export function TransactionHistory<T>({ filters, members, onFiltersChange, groups, renderItem, itemKey, countItems, isPending, isError, onRetry, emptyState, footer }: {
  filters: TransactionFilters
  members: LedgerMember[]
  onFiltersChange: (filters: TransactionFilters) => void
  groups: Array<{ date: string; items: T[] }>
  renderItem: (item: T) => ReactNode
  itemKey: (item: T) => string
  countItems?: (items: T[]) => number
  isPending: boolean
  isError: boolean
  onRetry: () => void
  emptyState?: ReactNode
  footer?: ReactNode
}) {
  return <>
    <TransactionHistoryTools filters={filters} members={members} onChange={onFiltersChange} />
    {isPending ? <div className="grid min-h-48 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />거래 내역을 불러오는 중…</span></div>
      : isError ? <div className="py-12 text-center"><p role="alert">거래 내역을 불러오지 못했어요.</p><Button className="mt-4" variant="secondary" onClick={onRetry}>다시 불러오기</Button></div>
      : groups.length ? <div className="mt-2">{groups.map((group) => <TransactionDateGroup key={group.date} date={group.date} count={countItems ? countItems(group.items) : group.items.length}>
        {group.items.map((item) => <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>)}
      </TransactionDateGroup>)}{footer}</div>
      : emptyState ?? <div className="py-12 text-center"><p className="text-sm text-[var(--muted)]">조건에 맞는 거래가 없어요.</p><Button variant="ghost" className="mt-3" onClick={() => onFiltersChange({})}>전체 거래 보기</Button></div>}
  </>
}
