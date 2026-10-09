import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError, api, jsonBody, type SessionUser } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'

type Profile = SessionUser & { version: number }
const profileKey = ['account-profile']
const getProfile = () => api<Profile>('/api/auth/profile')

function ErrorNotice({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="text-sm text-red-800 dark:text-red-200">{error.message}</p> : null
}

export function AccountProfileSettings({ active }: { active: boolean }) {
  const profile = useQuery({ queryKey: profileKey, queryFn: getProfile, enabled: active, staleTime: 0 })
  return <div className="mt-6 space-y-5">
    {profile.data ? <ProfileForm initial={profile.data} /> : <div role="status" className="text-sm text-[var(--muted)]">{profile.isError ? '계정 정보를 불러오지 못했어요.' : '계정 정보를 불러오는 중…'}{profile.isError ? <Button variant="ghost" onClick={() => profile.refetch()}>다시 시도</Button> : null}</div>}
  </div>
}

function ProfileForm({ initial }: { initial: Profile }) {
  const client = useQueryClient()
  const online = useOnlineStatus()
  // Keep the editing snapshot on focus/refetch; only an explicit conflict acknowledgement replaces it.
  const [snapshot, setSnapshot] = useState(initial)
  const [name, setName] = useState(initial.displayName)
  const [email, setEmail] = useState(initial.email)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sentEmail, setSentEmail] = useState('')
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [success, setSuccess] = useState(false)
  const [latest, setLatest] = useState<Profile>()
  const targetEmail = email.trim().toLowerCase()
  const emailChanged = targetEmail !== snapshot.email
  const changed = name.trim() !== snapshot.displayName || emailChanged
  const send = useMutation({
    mutationFn: () => api<void>('/api/auth/profile/email-verification', { method: 'POST', body: jsonBody({ email: targetEmail, expectedVersion: snapshot.version }) }),
    onSuccess: () => { setSentEmail(targetEmail); setVerifiedEmail(''); setCode(''); verify.reset() },
  })
  const verify = useMutation({
    mutationFn: () => api<void>('/api/auth/profile/email-verification/confirm', { method: 'POST', body: jsonBody({ email: targetEmail, code }) }),
    onSuccess: () => { setVerifiedEmail(targetEmail); setCode('') },
  })
  const save = useMutation({
    mutationFn: () => api<Profile>('/api/auth/profile', { method: 'PUT', body: jsonBody({ displayName: name, email: targetEmail, password, expectedVersion: snapshot.version }) }),
    onSuccess: async (profile) => {
      await client.cancelQueries()
      client.setQueryData(profileKey, profile)
      client.setQueryData(['session'], profile)
      setSnapshot(profile); setName(profile.displayName); setEmail(profile.email); setPassword(''); setCode('')
      setSentEmail(''); setVerifiedEmail(''); setSuccess(true); setLatest(undefined); send.reset(); verify.reset()
      // Names also appear in membership, asset and transaction read models.
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'account-profile' && query.queryKey[0] !== 'session' })
    },
  })
  const refresh = useMutation({ mutationFn: () => client.fetchQuery({ queryKey: profileKey, queryFn: getProfile, staleTime: 0 }), onSuccess: setLatest })
  const conflict = [save.error, send.error].some((error) => error instanceof ApiError && error.status === 412)
  const busy = save.isPending || send.isPending || verify.isPending || refresh.isPending
  function submit(event: FormEvent) {
    event.preventDefault(); setSuccess(false)
    if (online && !busy && changed && !conflict && (!emailChanged || verifiedEmail === targetEmail)) save.mutate()
  }
  return <section aria-labelledby="profile-title" className="rounded-xl bg-[var(--background)] p-4 sm:p-5">
    <h3 id="profile-title" className="font-semibold">프로필 수정</h3>
    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">로그인 아이디는 {snapshot.loginId}예요. 이름은 함께 쓰는 가계부에도 반영돼요.</p>
    <form className="mt-5 grid gap-4" onSubmit={submit}>
      <Field id="profile-name" label="이름" autoComplete="name" maxLength={100} required value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setSuccess(false) }} />
      <Field id="profile-email" label="이메일" type="email" autoComplete="email" maxLength={320} required value={email} disabled={busy} onChange={(event) => { setEmail(event.target.value); setVerifiedEmail(''); setSentEmail(''); setCode(''); setSuccess(false); send.reset(); verify.reset() }} />
      {emailChanged ? <div className="grid gap-3">
        <p className="text-xs leading-5 text-[var(--muted)]">새 이메일 인증 후 저장하면 주소가 변경돼요. 인증번호는 10분 동안 유효하고 1분 후 다시 받을 수 있어요.</p>
        <Button type="button" variant="secondary" disabled={!online || busy || !targetEmail || conflict} onClick={(event) => { const input = event.currentTarget.form?.querySelector<HTMLInputElement>('#profile-email'); if (input?.reportValidity()) send.mutate() }}>{send.isPending ? '전송 중…' : sentEmail === targetEmail ? '인증번호 다시 받기' : '인증번호 받기'}</Button>
        {sentEmail === targetEmail && verifiedEmail !== targetEmail ? <><p role="status" className="text-xs text-[var(--muted)]">인증번호를 보냈어요. 메일함과 스팸함을 확인해 주세요.</p><Field id="profile-email-code" label="이메일 인증번호" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} /><Button type="button" variant="secondary" disabled={!online || busy || code.length !== 8} onClick={() => verify.mutate()}>{verify.isPending ? '확인 중…' : '인증번호 확인'}</Button></> : null}
        {verifiedEmail === targetEmail ? <p role="status" className="text-sm text-forest-700 dark:text-forest-100">이메일 인증 완료. 현재 비밀번호로 저장해 주세요.</p> : null}
      </div> : null}
      <Field id="profile-password" label="현재 비밀번호" type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy} onChange={(event) => { setPassword(event.target.value); setSuccess(false) }} hint="계정 정보를 저장하려면 현재 비밀번호를 입력해 주세요." />
      <ErrorNotice error={save.error ?? send.error ?? verify.error ?? refresh.error} />
      {conflict ? <div className="grid gap-3 rounded-lg bg-[var(--surface)] p-3">
        <p className="text-sm">입력한 내용은 유지했어요. 최신 정보를 확인한 후 다시 저장해 주세요.</p>
        {!latest ? <Button type="button" variant="secondary" disabled={!online || busy} onClick={() => refresh.mutate()}>최신 정보 확인</Button> : <><p className="break-all text-sm">현재 저장된 이름: {latest.displayName}<br />현재 이메일: {latest.email}</p><Button type="button" variant="secondary" onClick={() => { setSnapshot(latest); setLatest(undefined); setVerifiedEmail(''); setSentEmail(''); setCode(''); save.reset(); send.reset(); verify.reset() }}>확인했어요 · 입력 내용 유지</Button></>}
      </div> : null}
      {!online ? <p role="status" className="text-sm text-[var(--muted)]">인터넷 연결 후 저장할 수 있어요. 입력한 내용은 유지돼요.</p> : null}
      {success ? <p role="status" className="text-sm text-forest-700 dark:text-forest-100">계정 정보를 저장했어요.</p> : null}
      <Button type="submit" disabled={!online || busy || !changed || !name.trim() || !password || conflict || (emailChanged && verifiedEmail !== targetEmail)}>{save.isPending ? '저장 중…' : '계정 정보 저장'}</Button>
    </form>
    <Button asChild variant="ghost" className="mt-3 w-full" disabled={busy}><Link to="/settings/password">비밀번호 변경</Link></Button>
  </section>
}
