import { ArrowLeft, ChartNoAxesCombined, House, Settings, SquarePen, WalletCards, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'
import { DondokLogo } from './DondokLogo'
import { LogoutButton } from './LogoutButton'
import { Button } from './ui/Button'

type NavigationItem = { to: string; label: string; icon: LucideIcon; end?: boolean }

const ledgerNavigationItems: NavigationItem[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/transactions/new', label: '기록', icon: SquarePen },
  { to: '/assets', label: '자산', icon: WalletCards },
  { to: '/statistics', label: '통계', icon: ChartNoAxesCombined },
]
const settingsNavigationItem: NavigationItem = { to: '/settings', label: '설정', icon: Settings }
const mobileNavigationItems = [...ledgerNavigationItems, settingsNavigationItem]

function LedgerNavigationLink({ to, label, icon: Icon, end, compact = false }: NavigationItem & { compact?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        'relative flex items-center text-sm font-semibold transition-colors',
        compact ? 'min-h-[3.75rem] min-w-0 w-full flex-col justify-center gap-0.5 rounded-[1rem] px-1 py-1 text-[.6875rem]' : 'min-h-12 w-full justify-center gap-3 rounded-md px-3 xl:justify-start',
        isActive
          ? compact
            ? 'text-forest-800 before:absolute before:bg-forest-600 dark:text-forest-100 dark:before:bg-forest-300'
            : 'bg-forest-100 text-forest-800 before:absolute before:bg-forest-600 dark:bg-forest-800 dark:text-white'
          : 'text-[var(--muted)] hover:bg-forest-50 hover:text-forest-800 dark:hover:bg-forest-800 dark:hover:text-white',
        !compact && 'before:left-0 before:h-6 before:w-1 before:rounded-full',
        compact && 'before:inset-x-3 before:bottom-0.5 before:h-0.5 before:rounded-full',
      )}
    >
      <Icon size={compact ? 20 : 21} aria-hidden="true" />
      <span className={compact ? undefined : 'md:sr-only xl:not-sr-only'}>{label}</span>
    </NavLink>
  )
}

type MobileHeader = {
  title: string
  backTo: string
  backLabel?: string
}

export function MobileLedgerNavigation() {
  return (
    <nav
      className="fixed right-[max(.75rem,env(safe-area-inset-right))] bottom-[var(--mobile-dock-bottom)] left-[max(.75rem,env(safe-area-inset-left))] z-40 mx-auto grid max-w-[31rem] grid-cols-5 rounded-[1.4rem] border border-[var(--line-subtle)] bg-[var(--surface)] px-1 shadow-[0_12px_36px_rgba(12,30,23,0.18)] md:hidden dark:shadow-[0_12px_36px_rgba(0,0,0,0.45)]"
      aria-label="주요 메뉴"
      data-mobile-navigation
    >
      {mobileNavigationItems.map((item) => <LedgerNavigationLink key={item.to} {...item} compact />)}
    </nav>
  )
}

export function AppShell({ children, ledgerNavigation = false, mobileHeader }: { children: ReactNode; ledgerNavigation?: boolean; mobileHeader?: MobileHeader }) {
  if (!ledgerNavigation) {
    return (
      <main className="min-h-dvh bg-cream-100 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-4 pl-[max(1rem,env(safe-area-inset-left))] text-ink-900 dark:bg-[#101714] dark:text-white xs:pr-[max(1.5rem,env(safe-area-inset-right))] xs:pl-[max(1.5rem,env(safe-area-inset-left))] md:pt-6 md:pr-[max(2rem,env(safe-area-inset-right))] md:pb-6 md:pl-[max(2rem,env(safe-area-inset-left))]">
        <div className="mx-auto max-w-6xl">
          <header className="flex items-center justify-between gap-3">
            <Link to="/" aria-label="돈독 홈"><DondokLogo className="h-10" /></Link>
            <div className="flex items-center gap-1">
              <LogoutButton labelClassName="hidden xs:inline" />
            </div>
          </header>
          {children}
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-cream-100 text-ink-900 dark:bg-[#101714] dark:text-white">
      <aside className="fixed inset-y-0 left-[env(safe-area-inset-left)] z-30 hidden w-20 flex-col border-r border-[var(--line)] bg-[var(--surface)] px-3 py-5 md:flex xl:w-60 xl:px-5" aria-label="주요 메뉴">
        <Link to="/" aria-label="돈독 홈" className="mx-auto grid size-12 place-items-center xl:mx-0 xl:w-auto xl:grid-cols-[2.5rem_1fr] xl:justify-items-start xl:gap-3">
          <img src="/dondok-mark.svg" alt="" className="size-10 dark:hidden" />
          <img src="/dondok-mark-reverse.svg" alt="" className="hidden size-10 dark:block" />
          <span className="hidden text-xl font-semibold tracking-[-.04em] text-forest-800 dark:text-white xl:block">돈독</span>
        </Link>
        <nav className="mt-8 grid gap-2">
          {ledgerNavigationItems.map((item) => <LedgerNavigationLink key={item.to} {...item} />)}
        </nav>
        <div className="mt-auto">
          <LedgerNavigationLink {...settingsNavigationItem} />
        </div>
      </aside>

      <main className="min-h-dvh pb-[var(--mobile-dock-clearance)] md:ml-[calc(5rem+env(safe-area-inset-left))] md:pb-0 xl:ml-[calc(15rem+env(safe-area-inset-left))]">
        {mobileHeader ? (
          <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] pt-[env(safe-area-inset-top)] pr-[max(.75rem,env(safe-area-inset-right))] pl-[max(.75rem,env(safe-area-inset-left))] md:hidden">
            <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center" data-mobile-context-header>
              <Button variant="ghost" size="icon" asChild>
                <Link to={mobileHeader.backTo} aria-label={mobileHeader.backLabel ?? '이전 화면으로'}><ArrowLeft size={20} /></Link>
              </Button>
              <h1 className="truncate px-2 text-center text-[1.0625rem] font-semibold tracking-[-.02em]">{mobileHeader.title}</h1>
              <span aria-hidden="true" />
            </div>
          </header>
        ) : null}
        <div className={cn('mx-auto max-w-[82rem] px-4 xs:px-5 md:px-6 lg:px-7 xl:px-8', !mobileHeader && 'pt-[env(safe-area-inset-top)] md:pt-0')}>
          {children}
        </div>
      </main>

    </div>
  )
}
