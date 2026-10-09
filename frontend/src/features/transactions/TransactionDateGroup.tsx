import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul',
})

export function TransactionDateGroup({ date, count, children, stickyHeader = true }: { date: string; count: number; children: ReactNode; stickyHeader?: boolean }) {
  const headingId = useId()
  const groupDate = new Date(`${date}T00:00:00Z`)
  const weekday = groupDate.getUTCDay()
  const dateColor = weekday === 0 ? 'text-[var(--calendar-income)]' : weekday === 6 ? 'text-[var(--calendar-expense)]' : 'text-[var(--muted)]'
  return (
    <section className={stickyHeader ? 'first:mt-4' : 'mt-6 first:mt-4'} aria-labelledby={headingId} data-transaction-date={date}>
      <header className={`flex items-baseline justify-between gap-3 border-t border-[var(--line-subtle)] py-2 ${stickyHeader ? 'sticky top-[var(--transaction-sticky-top,0px)] z-20 bg-[var(--background)]' : ''}`}>
        <h3 id={headingId} className={`text-xs font-normal tabular-nums ${dateColor}`}><time dateTime={date}>{dateFormat.format(groupDate)}</time></h3>
        {count > 0 ? <span className="shrink-0 text-xs text-[var(--muted)]">{count}건</span> : null}
      </header>
      <TransactionList>{children}</TransactionList>
    </section>
  )
}

export function TransactionList({ children }: { children: ReactNode }) {
  return <ul className="space-y-1 pl-3 md:pl-4" data-transaction-list>{children}</ul>
}

export function TransactionListRow({ children, to, returnTo, accessibleName }: { children: ReactNode; to?: string; returnTo?: string; accessibleName?: string }) {
  const className = 'grid min-h-16 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 md:px-2'
  return to ? (
    <Link to={to} state={{ returnTo }} aria-label={accessibleName} className={`${className} group transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-[var(--ring)]`}>
      {children}
    </Link>
  ) : <div className={className}>{children}</div>
}
