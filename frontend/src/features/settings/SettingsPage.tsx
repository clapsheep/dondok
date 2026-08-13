import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Clipboard, LoaderCircle, Plus, Tags, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { LogoutButton } from '../../components/LogoutButton'
import { ThemeSettings } from '../../components/ThemeSettings'
import { Button } from '../../components/ui/Button'
import { PageTitle } from '../../components/ui/PageTitle'
import { MemberList } from '../membership/MemberList'
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

export function SettingsPage({ ledger }: { ledger: LedgerBook }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deletionTrigger = useRef<HTMLButtonElement | null>(null)
  const [issued, setIssued] = useState<IssuedLedgerInvitation>()
  const [copied, setCopied] = useState<'code' | 'url'>()
  const [deletionSnapshot, setDeletionSnapshot] = useState<LedgerBook>()
  const invitations = useQuery({
    queryKey: membershipKeys.invitations,
    queryFn: membershipApi.invitations,
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
      setCopied(kind)
      window.setTimeout(() => setCopied(undefined), 1500)
    } catch {
      setCopied(undefined)
    }
  }

  return (
    <AppShell ledgerNavigation>
      <section className="py-8 md:py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-brass-500">설정</p>
          <PageTitle className="mt-1">가계부 설정</PageTitle>
          <p className="mt-3 leading-7 text-[var(--muted)]">내 화면을 조정하고, 구성원을 확인하거나 함께 기록할 사람을 초대할 수 있어요.</p>
        </div>

        <ThemeSettings />

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(24rem,1.1fr)] lg:divide-x lg:divide-[var(--line)]">
          <MemberList ledger={ledger} />

          <section className="min-w-0 lg:pl-8" aria-labelledby="invite-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 id="invite-title" className="text-xl font-semibold">구성원 초대</h2><p className="mt-1 text-sm text-[var(--muted)]">초대는 7일 동안 한 번만 사용할 수 있어요.</p></div>
              <Button onClick={() => issue.mutate()} disabled={issue.isPending}>{issue.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}새 초대</Button>
            </div>
            <ErrorNotice error={issue.error ?? revoke.error ?? invitations.error} />

            {issued ? (
              <div className="mt-5 border-l-4 border-forest-600 px-4 py-2" role="status">
                <p className="font-semibold">초대가 준비됐어요</p>
                <p className="mt-1 text-sm text-[var(--muted)]">6자리 코드는 직접 입력할 때, URL은 링크로 공유할 때 사용해요. 둘 다 지금만 다시 볼 수 있어요.</p>
                <CopyRow label="초대 코드" value={issued.code} copied={copied === 'code'} onCopy={() => copy('code', issued.code)} />
                <CopyRow label="초대 URL" value={issued.inviteUrl} copied={copied === 'url'} onCopy={() => copy('url', issued.inviteUrl)} />
              </div>
            ) : null}

            <div className="mt-5">
              <h3 className="text-sm font-semibold">발급 내역</h3>
              {invitations.isPending ? <p className="mt-3 text-sm text-[var(--muted)]">초대 내역을 불러오는 중…</p> : invitations.data?.length ? (
                <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                  {invitations.data.map((invitation) => (
                    <li key={invitation.invitationId} className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                      <span><span className="font-semibold">{statusLabel[invitation.status]}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{dateTime.format(new Date(invitation.expiresAt))}까지</span></span>
                      {invitation.status === 'ACTIVE' ? <Button variant="ghost" size="default" onClick={() => revoke.mutate(invitation.invitationId)} disabled={revoke.isPending}>취소</Button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 border-y border-[var(--line)] py-5 text-center text-sm text-[var(--muted)]">아직 발급한 초대가 없어요.</p>}
            </div>
          </section>
        </div>

        <section className="mt-10 max-w-4xl border-y border-[var(--line)]" aria-labelledby="category-settings-title">
          <Link to="/settings/categories" className="group grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-4 sm:px-2">
            <Tags className="text-forest-700 dark:text-forest-100" size={22} aria-hidden="true" />
            <span className="min-w-0"><span id="category-settings-title" className="block font-semibold group-hover:text-forest-700 dark:group-hover:text-forest-100">분류 설정</span><span className="mt-1 block text-sm text-[var(--muted)]">공동으로 쓰는 수입·지출 분류를 추가하거나 이름을 바꾸고 정리해요.</span></span>
            <ArrowRight className="text-[var(--muted)]" size={19} aria-hidden="true" />
          </Link>
        </section>

        <section className="mt-10 max-w-4xl border-t border-[var(--line)] pt-7" aria-labelledby="session-settings-title">
          <h2 id="session-settings-title" className="text-xl font-semibold">로그인</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">이 기기에서 돈독 사용을 마치고 로그인 화면으로 돌아갑니다.</p>
          <LogoutButton className="mt-4" variant="secondary" />
        </section>

        <section className="mt-12 max-w-4xl border-t border-[var(--line)] pt-7" aria-labelledby="destructive-settings-title">
          <p className="text-sm font-semibold text-red-800 dark:text-[#ffd5cf]">파괴적 작업</p>
          <h2 id="destructive-settings-title" className="mt-1 text-xl font-semibold">가계부 전체 삭제</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">모든 구성원의 공동 기록을 영구 삭제합니다. 구성원의 돈독 계정과 로그인은 유지됩니다.</p>
          <Button className="mt-4" type="button" variant="destructive" disabled={issue.isPending || revoke.isPending} onClick={(event) => { deletionTrigger.current = event.currentTarget; setDeletionSnapshot(snapshotLedger(ledger)) }}><Trash2 size={17} />가계부 삭제</Button>
        </section>

        {deletionSnapshot ? <LedgerDeletionDialog initialLedger={deletionSnapshot} onRequestClose={closeDeletionDialog} onResolved={resolveLedgerDeletion} /> : null}
      </section>
    </AppShell>
  )
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
      <div className="min-w-0"><p className="text-xs font-semibold">{label}</p><output aria-label={label} className="mt-1 block truncate border-b border-[var(--line)] px-1 py-2 font-mono text-sm" title={value}>{value}</output></div>
      <Button variant="secondary" size="icon" aria-label={`${label} 복사`} onClick={onCopy}>{copied ? <Check size={18} /> : <Clipboard size={18} />}</Button>
    </div>
  )
}
