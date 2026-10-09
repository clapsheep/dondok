import { ArrowLeft, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'

export function TransactionDetailLayout({ title, returnTo, actions, children }: { title: string; returnTo: string; actions?: ReactNode; children: ReactNode }) {
  return <AppShell ledgerNavigation mobileHeader={{ title, backTo: returnTo, backLabel: '거래 목록으로', action: actions }}>
    <section className="mx-auto max-w-[46rem] py-4 md:py-8">
      <Button asChild className="hidden md:inline-flex" variant="ghost"><Link to={returnTo}><ArrowLeft size={17} />목록으로 돌아가기</Link></Button>
      <header className="mb-4 hidden items-center justify-between gap-3 md:mt-3 md:flex">
        <h1 className="min-w-0 text-2xl font-semibold tracking-[-.025em]">{title}</h1>
        {actions}
      </header>
      {children}
    </section>
  </AppShell>
}

export function TransactionActionLink({ to, returnTo, label, icon: Icon }: { to: string; returnTo: string; label: string; icon: LucideIcon }) {
  return <Button asChild variant="ghost" size="icon" className="shrink-0 text-[var(--muted)]">
    <Link to={to} state={{ returnTo }} aria-label={label} title={label}><Icon size={20} aria-hidden="true" /></Link>
  </Button>
}

export function TransactionDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 py-3.5"><dt className="text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words font-semibold">{value}</dd></div>
}
