import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api, clearCsrfToken, subscribeLedgerNotFound, type SessionUser } from './lib/api'
import { CheckEmailPage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignUpPage, VerifyEmailPage } from './features/auth/AuthPages'
import { HomePage } from './features/home/HomePage'
import { JoinPage } from './features/membership/JoinPage'
import { membershipApi, membershipKeys, type CurrentLedgerBook } from './features/membership/api'
import { SettingsPage } from './features/settings/SettingsPage'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Button } from './components/ui/Button'
import { AssetsPage } from './features/assets/AssetsPage'
import { TransactionFormPage } from './features/transactions/TransactionFormPage'
import { CardPurchaseManagementPage, type CardPurchaseAction } from './features/transactions/CardPurchaseManagementPage'
import { CategorySettingsPage } from './features/categories/CategorySettingsPage'
import { ledgerExitReasonAfterCurrentRead, replaceLedgerClientState, type LedgerNavigationState } from './features/membership/ledgerLifecycle'
import { MobileLedgerNavigation } from './components/AppShell'

const CardStatementPage = lazy(() => import('./features/card-statements/CardStatementPage').then((module) => ({ default: module.CardStatementPage })))
const StatisticsPage = lazy(() => import('./features/statistics/StatisticsPage').then((module) => ({ default: module.StatisticsPage })))
const AssetFormPage = lazy(() => import('./features/assets/AssetFormPage').then((module) => ({ default: module.AssetFormPage })))

function LedgerLifecycleBoundary({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const recovering = useRef(false)
  const recoveryPanel = useRef<HTMLDivElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [checking, setChecking] = useState(false)
  const [recoveryError, setRecoveryError] = useState(false)

  useEffect(() => {
    if (!checking && !recoveryError) return
    requestAnimationFrame(() => recoveryPanel.current?.focus())
  }, [checking, recoveryError])

  const recoverCurrentLedger = useCallback(() => {
    if (recovering.current) return
    const previous = queryClient.getQueryData<CurrentLedgerBook>(membershipKeys.current)
    const previousLedgerId = previous?.ledger?.ledgerId
    if (!previousFocus.current && document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement
    recovering.current = true
    setChecking(true)
    setRecoveryError(false)
    void (async () => {
      let restoreFocus = false
      try {
        const current = await membershipApi.current()
        const ledgerExit = ledgerExitReasonAfterCurrentRead(current, previousLedgerId)
        if (!ledgerExit) {
          restoreFocus = true
          return
        }
        previousFocus.current = null
        await replaceLedgerClientState(queryClient, current)
        const state: LedgerNavigationState = { ledgerExit }
        navigate('/', { replace: true, state })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          previousFocus.current = null
          clearCsrfToken()
          queryClient.clear()
          navigate('/login', { replace: true })
          return
        }
        setRecoveryError(true)
      } finally {
        recovering.current = false
        setChecking(false)
        if (restoreFocus) {
          const target = previousFocus.current
          previousFocus.current = null
          requestAnimationFrame(() => target?.focus())
        }
      }
    })()
  }, [navigate, queryClient])

  useEffect(() => subscribeLedgerNotFound(() => {
    const cached = queryClient.getQueryData<CurrentLedgerBook>(membershipKeys.current)
    if (cached?.ledger === null) return
    recoverCurrentLedger()
  }), [queryClient, recoverCurrentLedger])

  const blocked = checking || recoveryError
  return (
    <>
      <div inert={blocked ? true : undefined} aria-hidden={blocked || undefined}>{children}</div>
      {blocked ? (
        <div ref={recoveryPanel} className="fixed inset-0 z-50 grid min-h-dvh place-items-center bg-cream-100 p-6 text-center outline-none dark:bg-[#101714]" tabIndex={-1} role={checking ? 'status' : 'alert'}>
          {checking ? <p className="text-sm text-[var(--muted)]">현재 가계부 상태를 확인하는 중…</p> : <div><p>현재 가계부 상태를 확인하지 못했어요. 기존 데이터는 지우지 않았습니다.</p><Button className="mt-4" type="button" variant="secondary" onClick={recoverCurrentLedger}>다시 확인</Button></div>}
        </div>
      ) : null}
    </>
  )
}

function ProtectedApp({ page, cardPurchaseAction = 'detail' }: { page: 'home' | 'join' | 'settings' | 'categories' | 'assets' | 'asset-form' | 'transaction-form' | 'card-purchase' | 'card-statement' | 'statistics'; cardPurchaseAction?: CardPurchaseAction }) {
  const location = useLocation()
  const [me, current] = useQueries({ queries: [
    {
      queryKey: ['session'],
      queryFn: () => api<SessionUser>('/api/auth/me').catch((error: { status?: number }) => {
        if (error.status === 401 || error.status === 403) return null
        throw error
      }),
    },
    {
      queryKey: membershipKeys.current,
      queryFn: () => membershipApi.current().catch((error: { status?: number }) => {
        if (error.status === 401 || error.status === 403) return null
        throw error
      }),
      staleTime: 0,
      refetchOnWindowFocus: 'always',
    },
  ] })

  if (me.isPending || current.isPending) return <main className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">가계부를 여는 중…</main>
  if (!me.data) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (current.isError || !current.data) return <main className="grid min-h-dvh place-items-center bg-cream-100 p-6 text-center dark:bg-[#101714]"><div><p role="alert">가계부 정보를 불러오지 못했어요.</p><Button className="mt-4" onClick={() => current.refetch()}>다시 불러오기</Button></div></main>
  const currentLedger = current.data as CurrentLedgerBook
  if (page === 'join') return currentLedger.ledger ? <Navigate to="/" replace /> : <JoinPage />
  if (page === 'settings') return currentLedger.ledger ? <SettingsPage ledger={currentLedger.ledger} /> : <Navigate to="/" replace />
  if (page === 'categories') return currentLedger.ledger ? <CategorySettingsPage /> : <Navigate to="/" replace />
  if (page === 'assets') return currentLedger.ledger ? <AssetsPage ledger={currentLedger.ledger} /> : <Navigate to="/" replace />
  if (page === 'asset-form') return currentLedger.ledger ? <Suspense fallback={<main className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">자산 화면을 여는 중…</main>}><AssetFormPage ledger={currentLedger.ledger} /></Suspense> : <Navigate to="/" replace />
  if (page === 'transaction-form') return currentLedger.ledger ? <TransactionFormPage ledger={currentLedger.ledger} /> : <Navigate to="/" replace />
  if (page === 'card-purchase') return currentLedger.ledger ? <CardPurchaseManagementPage ledger={currentLedger.ledger} action={cardPurchaseAction} /> : <Navigate to="/" replace />
  if (page === 'card-statement') return currentLedger.ledger ? <Suspense fallback={<main className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">카드 명세 화면을 여는 중…</main>}><CardStatementPage /></Suspense> : <Navigate to="/" replace />
  if (page === 'statistics') return currentLedger.ledger ? <Suspense fallback={<main className="grid min-h-dvh place-items-center text-sm text-[var(--muted)]">통계 화면을 여는 중…</main>}><StatisticsPage ledger={currentLedger.ledger} /></Suspense> : <Navigate to="/" replace />
  return <HomePage current={currentLedger} />
}

const ledgerRoutePrefixes = ['/assets', '/transactions', '/statistics', '/settings'] as const

function PersistentMobileLedgerNavigation() {
  const location = useLocation()
  const isLedgerRoute = location.pathname === '/'
    || ledgerRoutePrefixes.some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))
  const current = useQuery({
    queryKey: membershipKeys.current,
    queryFn: () => membershipApi.current().catch((error: { status?: number }) => {
      if (error.status === 401 || error.status === 403) return null
      throw error
    }),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    enabled: isLedgerRoute,
  })

  if (!isLedgerRoute || current.isError || !current.data?.ledger) return null
  return <MobileLedgerNavigation />
}

export default function App() {
  return (
    <LedgerLifecycleBoundary>
      <Routes>
        <Route path="/" element={<ProtectedApp page="home" />} />
        <Route path="/join" element={<ProtectedApp page="join" />} />
        <Route path="/assets" element={<ProtectedApp page="assets" />} />
        <Route path="/assets/new" element={<ProtectedApp page="asset-form" />} />
        <Route path="/assets/:assetId/card-statements/:statementId" element={<ProtectedApp page="card-statement" />} />
        <Route path="/assets/:assetId" element={<ProtectedApp page="asset-form" />} />
        <Route path="/transactions/new" element={<ProtectedApp page="transaction-form" />} />
        <Route path="/transactions/:transactionId/card-purchase" element={<ProtectedApp page="card-purchase" />} />
        <Route path="/transactions/:transactionId/card-purchase/correction" element={<ProtectedApp page="card-purchase" cardPurchaseAction="correction" />} />
        <Route path="/transactions/:transactionId/card-purchase/refund" element={<ProtectedApp page="card-purchase" cardPurchaseAction="refund" />} />
        <Route path="/transactions/:transactionId" element={<ProtectedApp page="transaction-form" />} />
        <Route path="/statistics" element={<ProtectedApp page="statistics" />} />
        <Route path="/settings" element={<ProtectedApp page="settings" />} />
        <Route path="/settings/categories" element={<ProtectedApp page="categories" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/check-email" element={<CheckEmailPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PersistentMobileLedgerNavigation />
      <UpdatePrompt />
    </LedgerLifecycleBoundary>
  )
}
