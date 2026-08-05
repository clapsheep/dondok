import { ArrowLeft, ChartNoAxesCombined, House, LogOut, Settings, SquarePen, WalletCards, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { api, clearCsrfToken } from '../lib/api'
import { cn } from '../lib/cn'
import { DondokLogo } from './DondokLogo'
import { ThemeToggle } from './ThemeToggle'
import { Button } from './ui/Button'

const ledgerNavigationItems: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: '홈', icon: House, end: true },
  { to: '/transactions/new', label: '기록', icon: SquarePen },
  { to: '/assets', label: '자산', icon: WalletCards },
  { to: '/statistics', label: '통계', icon: ChartNoAxesCombined },
]

function LedgerNavigationLink({ to, label, icon: Icon, end, compact = false }: (typeof ledgerNavigationItems)[number] & { compact?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        'relative flex items-center text-sm font-semibold transition-colors',
        compact ? 'min-h-[3.75rem] min-w-16 flex-col justify-center gap-0.5 rounded-[1rem] px-2 py-1 text-[.6875rem]' : 'min-h-12 w-full justify-center gap-3 rounded-md px-3 xl:justify-start',
        isActive
          ? compact
            ? 'text-forest-800 before:absolute before:bg-forest-600 dark:text-forest-100 dark:before:bg-forest-300'
            : 'bg-forest-100 text-forest-800 before:absolute before:bg-forest-600 dark:bg-forest-800 dark:text-white'
          : 'text-[var(--muted)] hover:bg-forest-50 hover:text-forest-800 dark:hover:bg-forest-800 dark:hover:text-white',
        !compact && 'before:left-0 before:h-6 before:w-1 before:rounded-full',
        compact && 'before:inset-x-5 before:bottom-0.5 before:h-0.5 before:rounded-full',
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

export function AppShell({ children, ledgerNavigation = false, mobileHeader }: { children: ReactNode; ledgerNavigation?: boolean; mobileHeader?: MobileHeader }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: () => api<void>('/api/auth/session', { method: 'DELETE' }),
    onSuccess: () => {
      clearCsrfToken()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  if (!ledgerNavigation) {
    return (
      <main className="min-h-dvh bg-cream-100 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-4 pl-[max(1rem,env(safe-area-inset-left))] text-ink-900 dark:bg-[#101714] dark:text-white xs:pr-[max(1.5rem,env(safe-area-inset-right))] xs:pl-[max(1.5rem,env(safe-area-inset-left))] md:pt-6 md:pr-[max(2rem,env(safe-area-inset-right))] md:pb-6 md:pl-[max(2rem,env(safe-area-inset-left))]">
        <div className="mx-auto max-w-6xl">
          <header className="flex items-center justify-between gap-3">
            <Link to="/" aria-label="돈독 홈"><DondokLogo className="h-10" /></Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button variant="ghost" aria-label="로그아웃" onClick={() => logout.mutate()} disabled={logout.isPending}>
                <LogOut size={18} />
                <span className="hidden xs:inline">로그아웃</span>
              </Button>
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
        <div className="mt-auto grid justify-items-center gap-1 xl:justify-items-stretch">
          <Button className="w-11 px-0 xl:w-full xl:justify-start xl:px-3" variant="ghost" asChild>
            <Link to="/settings" aria-label="설정"><Settings size={18} /><span className="hidden xl:inline">설정</span></Link>
          </Button>
          <div className="xl:pl-1"><ThemeToggle /></div>
          <Button className="w-11 px-0 xl:w-full xl:justify-start xl:px-3" variant="ghost" aria-label="로그아웃" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut size={18} />
            <span className="hidden xl:inline">로그아웃</span>
          </Button>
        </div>
      </aside>

      <main className="min-h-dvh pb-[var(--mobile-dock-clearance)] md:ml-[calc(5rem+env(safe-area-inset-left))] md:pb-0 xl:ml-[calc(15rem+env(safe-area-inset-left))]">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] pt-[env(safe-area-inset-top)] pr-[max(.75rem,env(safe-area-inset-right))] pl-[max(.75rem,env(safe-area-inset-left))] md:hidden">
          {mobileHeader ? (
            <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center" data-mobile-context-header>
              <Button variant="ghost" size="icon" asChild>
                <Link to={mobileHeader.backTo} aria-label={mobileHeader.backLabel ?? '이전 화면으로'}><ArrowLeft size={20} /></Link>
              </Button>
              <h1 className="truncate px-2 text-center text-[1.0625rem] font-semibold tracking-[-.02em]">{mobileHeader.title}</h1>
              <span aria-hidden="true" />
            </div>
          ) : (
            <>
              <Link to="/" aria-label="돈독 홈"><DondokLogo className="h-9" /></Link>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" asChild><Link to="/settings" aria-label="설정"><Settings size={18} /></Link></Button>
                <ThemeToggle />
                <Button variant="ghost" size="icon" aria-label="로그아웃" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={18} /></Button>
              </div>
            </>
          )}
        </header>
        <div className="mx-auto max-w-[82rem] px-4 xs:px-5 md:px-6 lg:px-7 xl:px-8">
          {children}
        </div>
      </main>

      <nav
        className="fixed right-[max(.75rem,env(safe-area-inset-right))] bottom-[var(--mobile-dock-bottom)] left-[max(.75rem,env(safe-area-inset-left))] z-40 mx-auto grid max-w-[31rem] grid-cols-4 rounded-[1.4rem] border border-[var(--line-subtle)] bg-[var(--surface)] px-1 shadow-[0_12px_36px_rgba(12,30,23,0.18)] md:hidden dark:shadow-[0_12px_36px_rgba(0,0,0,0.45)]"
        aria-label="주요 메뉴"
        data-mobile-navigation
      >
        {ledgerNavigationItems.map((item) => <LedgerNavigationLink key={item.to} {...item} compact />)}
      </nav>
    </div>
  )
}
