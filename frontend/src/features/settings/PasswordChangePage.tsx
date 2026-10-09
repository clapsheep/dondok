import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageTitle } from '../../components/ui/PageTitle'
import { api, clearCsrfToken, jsonBody } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'

export function PasswordChangePage({ ledgerNavigation }: { ledgerNavigation: boolean }) {
  const online = useOnlineStatus()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation({
    mutationFn: () => api<void>('/api/auth/password', { method: 'PUT', body: jsonBody({ currentPassword: current, newPassword: password, newPasswordConfirm: confirm }) }),
    onSuccess: async () => { await client.cancelQueries(); clearCsrfToken(); client.clear(); navigate('/login?passwordChanged=1', { replace: true }) },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) { setMismatch(true); return }
    setMismatch(false)
    if (online && !change.isPending) change.mutate()
  }
  return <AppShell ledgerNavigation={ledgerNavigation}>
    <section aria-labelledby="password-title" className="mx-auto max-w-lg py-7 md:py-10">
    <Button asChild variant="ghost" className="mb-5 -ml-3" disabled={change.isPending}><Link to="/settings?section=account"><ArrowLeft size={17} />내 계정으로 돌아가기</Link></Button>
    <PageTitle id="password-title">비밀번호 변경</PageTitle>
    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">변경 후에는 모든 기기에서 새 비밀번호로 다시 로그인해 주세요.</p>
    <form className="mt-5 grid gap-4" onSubmit={submit}>
      <Field id="change-current-password" label="기존 비밀번호" type="password" autoComplete="current-password" required maxLength={128} value={current} disabled={change.isPending} onChange={(event) => setCurrent(event.target.value)} />
      <Field id="change-new-password" label="새 비밀번호" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} disabled={change.isPending} onChange={(event) => { setPassword(event.target.value); setMismatch(false) }} hint="10~128자로 입력해 주세요." />
      <Field id="change-confirm-password" label="새 비밀번호 확인" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={confirm} disabled={change.isPending} onChange={(event) => { setConfirm(event.target.value); setMismatch(false) }} error={mismatch ? '새 비밀번호가 서로 달라요.' : undefined} />
      {change.error ? <p role="alert" className="text-sm text-red-800 dark:text-red-200">{change.error.message}</p> : null}
      {!online ? <p role="status" className="text-sm text-[var(--muted)]">인터넷 연결 후 비밀번호를 변경할 수 있어요.</p> : null}
      <Button type="submit" disabled={!online || change.isPending || !current || !password || !confirm}>{change.isPending ? '변경 중…' : '비밀번호 변경'}</Button>
    </form>
    </section>
  </AppShell>
}
