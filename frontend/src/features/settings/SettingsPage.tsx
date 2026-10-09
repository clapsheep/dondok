import { LegalLinks } from '../legal/LegalPages'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Clipboard, LoaderCircle, Plus, Tags, Trash2, UsersRound, SunMoon, UserRound, ChevronDown } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { LogoutButton } from '../../components/LogoutButton'
import { ThemeSettings } from '../../components/ThemeSettings'
import { Button } from '../../components/ui/Button'
import { PageTitle } from '../../components/ui/PageTitle'
import { MemberAvatar } from '../../components/MemberAvatar'
import { type SessionUser } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { AccountProfileSettings } from './AccountProfileSettings'
import { AccountWithdrawalDialog } from './AccountWithdrawalDialog'
import {
  membershipApi,
  membershipKeys,
  type InvitationStatus,
  type IssuedLedgerInvitation,
  type LedgerBook,
} from '../membership/api'
import { replaceLedgerClientState, snapshotLedger, type LedgerNavigationState } from '../membership/ledgerLifecycle'
import { LedgerDeletionDialog, type LedgerDeletionOutcome } from './LedgerDeletionDialog'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const statusLabel: Record<InvitationStatus, string> = { ACTIVE: '사용 가능', REDEEMED: '사용 완료', REVOKED: '취소됨', EXPIRED: '만료됨' }

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="mt-4 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : '요청을 처리하지 못했어요.'}</p>
}

export function SettingsPage({ ledger, user }: { ledger: LedgerBook | null; user: SessionUser }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('section') ?? (ledger ? 'ledger' : 'account')
  const section = ['ledger', 'display', 'account'].includes(requested) ? requested : 'ledger'
  const online = useOnlineStatus()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [copyError, setCopyError] = useState('')
  const withdrawalTrigger = useRef<HTMLButtonElement | null>(null)
  const activeMembers = ledger?.members.filter((member) => !member.withdrawn) ?? []
  function closeWithdrawal() {
    setParams((current) => { current.delete('withdraw'); return current }, { replace: true })
    requestAnimationFrame(() => withdrawalTrigger.current?.focus())
  }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deletionTrigger = useRef<HTMLButtonElement | null>(null)
  const [issued, setIssued] = useState<IssuedLedgerInvitation>()
  const [copied, setCopied] = useState<'code' | 'url'>()
  const [deletionSnapshot, setDeletionSnapshot] = useState<LedgerBook>()
  const invitations = useQuery({
    queryKey: membershipKeys.invitations,
    queryFn: membershipApi.invitations,
    enabled: Boolean(ledger) && section === 'ledger',
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const issue = useMutation({
    mutationFn: membershipApi.issueInvitation,
    onSuccess: async (invitation) => {
      setIssued(invitation)
      await refreshMembershipQueries()
    },
  })
  const revoke = useMutation({
    mutationFn: membershipApi.revokeInvitation,
    onSuccess: refreshMembershipQueries,
  })

  async function refreshMembershipQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: membershipKeys.invitations }),
      queryClient.fetchQuery({ queryKey: membershipKeys.current, queryFn: membershipApi.current, staleTime: 0 }),
    ])
  }

  const closeDeletionDialog = useCallback(() => {
    setDeletionSnapshot(undefined)
    requestAnimationFrame(() => deletionTrigger.current?.focus())
  }, [])

  const resolveLedgerDeletion = useCallback(async ({ current, reason }: LedgerDeletionOutcome) => {
    await replaceLedgerClientState(queryClient, current)
    navigate('/', { replace: true, state: { ledgerExit: reason } satisfies LedgerNavigationState })
  }, [navigate, queryClient])

  async function copy(kind: 'code' | 'url', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyError('')
      setCopied(kind)
      window.setTimeout(() => setCopied(undefined), 1500)
    } catch {
      setCopyError('복사하지 못했어요. 코드나 링크를 직접 선택해 복사해 주세요.')
      setCopied(undefined)
    }
  }

  return (
    <AppShell ledgerNavigation={Boolean(ledger)}>
      <section className="mx-auto max-w-5xl py-7 md:py-10">
        <PageTitle>가계부 설정</PageTitle>
        <p className="mt-2 text-sm text-[var(--muted)]">함께 쓰는 가계부와 나의 사용 환경을 관리해요.</p>
        <div className="mt-7 grid items-start gap-6 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-9">
          <nav aria-label="설정 항목" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface)] p-1 md:grid-cols-1 md:gap-2 md:bg-transparent md:p-0">
            {([{ id: 'ledger', label: '공동 가계부', icon: UsersRound }, { id: 'display', label: '화면', icon: SunMoon }, { id: 'account', label: '내 계정', icon: UserRound }] as const).map(({ id, label, icon: Icon }) => (
              <Button key={id} variant="ghost" aria-current={section === id ? 'page' : undefined} className={`min-w-0 gap-2 px-2 text-xs md:justify-start md:px-4 md:text-sm ${section === id ? 'bg-[var(--surface-selected)] font-semibold text-forest-800 dark:text-forest-100' : 'text-[var(--muted)]'}`} onClick={() => setParams((current) => { current.set('section', id); current.delete('withdraw'); return current })}><Icon size={17} className="hidden md:block" aria-hidden="true" />{label}</Button>
            ))}
          </nav>
          <div className="min-w-0">
            <div hidden={section !== 'ledger'} className="space-y-5">
              {ledger ? <>
                <section className="rounded-2xl bg-[var(--surface)] p-5 sm:p-6" aria-labelledby="members-title">
                  <div className="flex items-center justify-between gap-3"><h2 id="members-title" className="text-lg font-semibold">함께 쓰는 가계부</h2><span className="text-sm text-[var(--muted)]">구성원 {activeMembers.length}명</span></div>
                  <ul className="mt-4 flex flex-wrap gap-2">{activeMembers.map((member) => <li key={member.memberId} className="flex min-w-0 items-center gap-2 rounded-full bg-[var(--background)] py-2 pl-2 pr-3 text-sm"><MemberAvatar displayName={member.displayName} memberId={member.memberId} /><span className="break-all">{member.displayName}</span>{member.currentUser ? <span className="text-xs text-[var(--muted)]">나</span> : null}</li>)}</ul>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--muted)]">초대는 7일 동안 한 번만 사용할 수 있어요.</p><Button onClick={() => issue.mutate()} disabled={!online || issue.isPending || revoke.isPending}>{issue.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}새 초대</Button></div>
                  <ErrorNotice error={issue.error ?? revoke.error ?? invitations.error} />
                  {!online ? <p className="mt-3 text-sm text-[var(--muted)]" role="status">인터넷 연결 후 초대를 관리할 수 있어요.</p> : null}
                  {issued ? <div className="mt-5 rounded-lg bg-[var(--background)] p-4" role="status"><p className="font-semibold">초대가 준비됐어요</p><p className="mt-1 text-xs text-[var(--muted)]">코드와 링크는 지금만 다시 볼 수 있어요.</p><CopyRow label="초대 코드" value={issued.code} copied={copied === 'code'} onCopy={() => copy('code', issued.code)} /><CopyRow label="초대 URL" value={issued.inviteUrl} copied={copied === 'url'} onCopy={() => copy('url', issued.inviteUrl)} />{copyError ? <p className="mt-2 text-sm" role="alert">{copyError}</p> : null}</div> : null}
                  <Button className="mt-4 gap-1 px-0 text-[var(--muted)]" variant="ghost" aria-expanded={historyOpen} aria-controls="invitation-history" onClick={() => setHistoryOpen(!historyOpen)}>초대 내역{invitations.data ? ` ${invitations.data.length}건` : ''}<ChevronDown size={16} className={historyOpen ? 'rotate-180' : ''} /></Button>
                  <div id="invitation-history" hidden={!historyOpen}>
                    {invitations.isPending ? <p className="mt-3 text-sm text-[var(--muted)]">초대 내역을 불러오는 중…</p> : invitations.data?.length ? <ul className="mt-2 space-y-2">{invitations.data.map((invitation) => <li key={invitation.invitationId} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--background)] px-3 py-3 text-sm"><span><span className="font-medium">{statusLabel[invitation.status]}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{dateTime.format(new Date(invitation.expiresAt))}까지</span></span>{invitation.status === 'ACTIVE' ? <Button variant="ghost" onClick={() => revoke.mutate(invitation.invitationId)} disabled={!online || revoke.isPending}>취소</Button> : null}</li>)}</ul> : <p className="py-3 text-sm text-[var(--muted)]">아직 발급한 초대가 없어요.</p>}
                    {invitations.isError ? <Button variant="ghost" disabled={!online} onClick={() => invitations.refetch()}>다시 불러오기</Button> : null}
                  </div>
                </section>
                <section className="rounded-2xl bg-[var(--surface)] p-5 sm:p-6" aria-labelledby="category-settings-title"><Link to="/settings/categories" className="flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><Tags className="shrink-0 text-forest-700 dark:text-forest-100" size={21} aria-hidden="true" /><span className="min-w-0 flex-1"><span id="category-settings-title" className="block font-semibold">분류 설정</span><span className="mt-1 block text-sm text-[var(--muted)]">함께 쓰는 수입·지출 분류를 정리해요.</span></span><ArrowRight size={18} className="shrink-0 text-[var(--muted)]" aria-hidden="true" /></Link></section>
                <section className="px-1 pt-4" aria-labelledby="destructive-settings-title"><h2 id="destructive-settings-title" className="text-sm font-semibold">가계부 전체 삭제</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">모든 구성원의 공동 기록이 삭제돼요. 돈독 계정은 유지돼요.</p><Button className="mt-2 px-0 text-red-800 dark:text-red-200" variant="ghost" disabled={!online || issue.isPending || revoke.isPending} onClick={(event) => { deletionTrigger.current = event.currentTarget; setDeletionSnapshot(snapshotLedger(ledger)) }}><Trash2 size={16} />가계부 삭제</Button></section>
              </> : <section className="rounded-2xl bg-[var(--surface)] p-6"><h2 className="font-semibold">아직 참여 중인 가계부가 없어요</h2><Button asChild className="mt-4" variant="secondary"><Link to="/">가계부 시작하기</Link></Button></section>}
            </div>
            <div hidden={section !== 'display'}><ThemeSettings /></div>
            <section hidden={section !== 'account'} className="rounded-2xl bg-[var(--surface)] p-5 sm:p-6" aria-labelledby="account-settings-title">
              <h2 id="account-settings-title" className="text-lg font-semibold">내 계정</h2>
              <div className="mt-5 flex min-w-0 items-center gap-3"><MemberAvatar displayName={user.displayName} memberId={user.userId} size="md" /><div className="min-w-0"><p className="break-all font-semibold">{user.displayName}</p><p className="mt-0.5 break-all text-sm text-[var(--muted)]">{user.email}</p></div></div>
              <p className="mt-4 text-xs text-[var(--muted)]">아이디와 이메일은 다른 구성원에게 공개되지 않아요.</p>
              <AccountProfileSettings active={section === 'account'} />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><LogoutButton variant="secondary" /><Button variant="ghost" className="text-sm text-[var(--muted)] underline underline-offset-4" onClick={(event) => { withdrawalTrigger.current = event.currentTarget; setParams((current) => { current.set('section', 'account'); current.set('withdraw', '1'); return current }) }}>회원 탈퇴</Button></div>
            </section>
          </div>
        </div>
        {deletionSnapshot ? <LedgerDeletionDialog initialLedger={deletionSnapshot} onRequestClose={closeDeletionDialog} onResolved={resolveLedgerDeletion} /> : null}
        {params.get('withdraw') === '1' ? <AccountWithdrawalDialog ledger={ledger} onClose={closeWithdrawal} /> : null}
      </section>
      <LegalLinks />
    </AppShell>
  )
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><div className="min-w-0"><p className="text-xs font-semibold">{label}</p><output aria-label={label} className="mt-1 block break-all rounded-md bg-[var(--surface)] px-2 py-2 font-mono text-sm">{value}</output></div><Button variant="secondary" size="icon" aria-label={`${label} 복사`} onClick={onCopy}>{copied ? <Check size={18} /> : <Clipboard size={18} />}</Button></div>
}
