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
        'relative flex items-center text-sm transition-colors',
        compact ? 'min-h-[3.75rem] min-w-0 w-full flex-col justify-center gap-1 rounded-xl px-1 py-1 text-[.6875rem]' : 'min-h-12 w-full justify-center gap-3 rounded-xl px-3 xl:min-h-11 xl:w-auto xl:gap-2 xl:px-5',
        isActive ? 'bg-[var(--surface-selected)] font-semibold text-[var(--selection)]' : 'font-medium text-[var(--muted)] hover:bg-[var(--surface-hover)]',
      )}
    >
      <Icon size={compact ? 20 : 21} className={compact ? undefined : cn('shrink-0', to === settingsNavigationItem.to ? 'xl:size-[18px]' : 'xl:hidden')} aria-hidden="true" />
      <span className={compact ? undefined : 'md:sr-only xl:not-sr-only'}>{label}</span>
    </NavLink>
  )
}

type MobileHeader = {
  title: string
  backTo: string
  backLabel?: string
  action?: ReactNode
}

export function MobileLedgerNavigation() {
  return (
    <nav
      className="fixed right-[max(.75rem,env(safe-area-inset-right))] bottom-[var(--mobile-dock-bottom)] left-[max(.75rem,env(safe-area-inset-left))] z-40 mx-auto grid max-w-[31rem] grid-cols-5 rounded-[1.4rem] bg-[var(--surface)] p-1 shadow-[0_12px_36px_rgba(0,0,0,0.12)] md:hidden dark:shadow-[0_12px_36px_rgba(0,0,0,0.45)]"
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
      <main className="min-h-dvh bg-[var(--background)] pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-4 pl-[max(1rem,env(safe-area-inset-left))] text-ink-900 dark:text-white xs:pr-[max(1.5rem,env(safe-area-inset-right))] xs:pl-[max(1.5rem,env(safe-area-inset-left))] md:pt-6 md:pr-[max(2rem,env(safe-area-inset-right))] md:pb-6 md:pl-[max(2rem,env(safe-area-inset-left))]">
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
    <div className="min-h-dvh bg-[var(--background)] text-ink-900 [--app-header-height:0px] xl:[--app-header-height:calc(4rem+env(safe-area-inset-top))] dark:text-white">
      <aside className="fixed inset-y-0 left-[env(safe-area-inset-left)] z-30 hidden w-20 flex-col bg-[var(--background)] px-3 py-5 md:flex xl:right-0 xl:bottom-auto xl:h-[var(--app-header-height)] xl:w-auto xl:border-r-0  xl:px-0 xl:pt-[env(safe-area-inset-top)] xl:pb-0" aria-label="주요 메뉴">
        <div className="flex h-full min-h-0 flex-col xl:mx-auto xl:w-full xl:max-w-[82rem] xl:flex-row xl:items-center xl:gap-10 xl:px-8">
          <Link to="/" aria-label="돈독 홈" className="mx-auto flex min-h-12 min-w-12 items-center justify-center rounded-md xl:mx-0 xl:min-h-11 xl:shrink-0 xl:justify-start">
            <img src="/brand/dondok-app-icon.svg" width="1024" height="1024" alt="" className="size-10 xl:hidden" />
            <DondokLogo className="hidden h-7 xl:inline-flex" />
          </Link>
          <nav className="mt-8 grid gap-2 xl:mt-0 xl:flex xl:items-center xl:gap-2">
            {ledgerNavigationItems.map((item) => <LedgerNavigationLink key={item.to} {...item} />)}
          </nav>
          <div className="mt-auto xl:mt-0 xl:ml-auto xl:flex xl:items-center">
            <LedgerNavigationLink {...settingsNavigationItem} />
          </div>
        </div>
      </aside>

      <main className={cn("min-h-dvh pb-[var(--mobile-dock-clearance)] md:ml-[calc(5rem+env(safe-area-inset-left))] md:pb-0 xl:ml-0 xl:pt-[var(--app-header-height)] xl:[--transaction-sticky-top:var(--app-header-height)]", mobileHeader ? "[--transaction-sticky-top:calc(3.5rem+env(safe-area-inset-top))] md:[--transaction-sticky-top:0px]" : "[--transaction-sticky-top:0px]")}>
        {mobileHeader ? (
          <header className="sticky top-0 z-30 flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 bg-[var(--background)] pt-[env(safe-area-inset-top)] pr-[max(.75rem,env(safe-area-inset-right))] pl-[max(.75rem,env(safe-area-inset-left))] md:hidden">
            <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center" data-mobile-context-header>
              <Button variant="ghost" size="icon" asChild>
                <Link to={mobileHeader.backTo} aria-label={mobileHeader.backLabel ?? '이전 화면으로'}><ArrowLeft size={20} /></Link>
              </Button>
              <h1 className="truncate px-2 text-center text-[1.0625rem] font-semibold tracking-[-.02em]">{mobileHeader.title}</h1>
              <div className="flex min-h-11 min-w-11 items-center justify-end">{mobileHeader.action}</div>
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
