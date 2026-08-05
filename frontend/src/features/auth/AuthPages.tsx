import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, LoaderCircle, Mail } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError, api, jsonBody, type SessionUser } from '../../lib/api'
import { AuthLayout } from './AuthLayout'

function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="border-l-4 border-red-600 px-3.5 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : '요청을 처리하지 못했어요.'}</p>
}

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const next = safeNext(params.get('next'))
  const login = useMutation({
    mutationFn: (body: { loginId: string; password: string }) => api<SessionUser>('/api/auth/session', { method: 'POST', body: jsonBody(body) }),
    onSuccess: (user) => { queryClient.setQueryData(['session'], user); navigate(next, { replace: true }) },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    login.mutate({ loginId: String(data.get('loginId')), password: String(data.get('password')) })
  }
  return (
    <AuthLayout eyebrow="다시 만나 반가워요" title="돈독에 로그인" description="함께 기록하던 가계부를 이어서 정리해요.">
      <form className="grid gap-5" onSubmit={submit}>
        <Field id="loginId" name="loginId" label="아이디" autoComplete="username" required autoFocus />
        <Field id="password" name="password" label="비밀번호" type="password" autoComplete="current-password" required />
        <ErrorMessage error={login.error} />
        <Button type="submit" size="large" disabled={login.isPending}>{login.isPending && <LoaderCircle className="animate-spin" size={18} />}로그인</Button>
      </form>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link className="text-[var(--muted)] underline-offset-4 hover:underline" to="/forgot-password">비밀번호를 잊었나요?</Link>
        <Link className="font-semibold text-forest-700 dark:text-forest-100" to={`/sign-up?next=${encodeURIComponent(next)}`}>처음이라면 회원가입</Link>
      </div>
    </AuthLayout>
  )
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [checkedId, setCheckedId] = useState('')
  const [checkingId, setCheckingId] = useState(false)
  const [idError, setIdError] = useState<string>()
  const [passwordError, setPasswordError] = useState<string>()
  const signUp = useMutation({
    mutationFn: (body: { loginId: string; displayName: string; email: string; password: string }) => api<{ email: string }>('/api/auth/sign-up', { method: 'POST', body: jsonBody(body) }),
    onSuccess: ({ email }) => navigate(`/check-email?next=${encodeURIComponent(next)}`, { replace: true, state: { email } }),
  })

  async function checkLoginId(form: HTMLFormElement) {
    const loginId = String(new FormData(form).get('loginId') ?? '')
    if (!/^[A-Za-z0-9._-]{4,30}$/.test(loginId)) { setIdError('영문, 숫자, 점, 밑줄, 하이픈으로 4~30자 입력해 주세요.'); return }
    setCheckingId(true); setIdError(undefined)
    try {
      const result = await api<{ available: boolean }>(`/api/auth/login-ids/${encodeURIComponent(loginId)}/availability`)
      if (result.available) setCheckedId(loginId)
      else { setCheckedId(''); setIdError('이미 사용 중인 아이디예요.') }
    } catch (error) { setIdError(error instanceof Error ? error.message : '중복 확인을 완료하지 못했어요.') }
    finally { setCheckingId(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const loginId = String(data.get('loginId'))
    if (checkedId !== loginId) { setIdError('아이디 중복 확인을 먼저 해 주세요.'); return }
    const password = String(data.get('password'))
    if (password !== String(data.get('passwordConfirm'))) { signUp.reset(); setPasswordError('비밀번호가 서로 달라요.'); return }
    setPasswordError(undefined)
    signUp.mutate({ loginId, displayName: String(data.get('displayName')), email: String(data.get('email')), password })
  }

  return (
    <AuthLayout eyebrow="차곡차곡 시작하기" title="돈독 회원가입" description="가입 후 이메일을 확인하면 함께 쓸 가계부를 만들 수 있어요.">
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field id="loginId" name="loginId" label="아이디" autoComplete="username" required onChange={() => { setCheckedId(''); setIdError(undefined) }} error={idError} />
          <Button type="button" variant="secondary" className="mb-[1px]" disabled={checkingId} onClick={(event) => checkLoginId(event.currentTarget.form!)}>{checkedId ? '확인 완료' : checkingId ? '확인 중' : '중복 확인'}</Button>
        </div>
        <Field id="displayName" name="displayName" label="이름" autoComplete="name" maxLength={100} required />
        <Field id="email" name="email" label="이메일" type="email" autoComplete="email" required />
        <Field id="password" name="password" label="비밀번호" type="password" autoComplete="new-password" minLength={10} maxLength={128} required hint="10자 이상 입력해 주세요." />
        <Field id="passwordConfirm" name="passwordConfirm" label="비밀번호 확인" type="password" autoComplete="new-password" minLength={10} required error={passwordError} onChange={() => setPasswordError(undefined)} />
        <ErrorMessage error={signUp.error instanceof ApiError && signUp.error.status === 409 ? new Error('아이디 또는 이메일이 이미 사용 중이에요.') : signUp.error} />
        <Button type="submit" size="large" className="mt-2" disabled={signUp.isPending}>{signUp.isPending && <LoaderCircle className="animate-spin" size={18} />}가입하고 인증 메일 받기</Button>
      </form>
      <p className="mt-5 text-center text-sm text-[var(--muted)]">이미 계정이 있나요? <Link className="font-semibold text-forest-700 dark:text-forest-100" to={`/login?next=${encodeURIComponent(next)}`}>로그인</Link></p>
    </AuthLayout>
  )
}

export function CheckEmailPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  return <AuthLayout title="이메일을 확인해 주세요" description="보낸 인증 링크는 24시간 동안 사용할 수 있어요."><StatusIcon icon={<Mail size={30} />} /><p className="mt-6 text-sm leading-6 text-[var(--muted)]">메일함에 돈독 인증 메일이 없다면 스팸함도 확인해 주세요.</p><Button asChild size="large" className="mt-7 w-full"><Link to={`/login?next=${encodeURIComponent(next)}`}>로그인으로 돌아가기</Link></Button></AuthLayout>
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const verification = useMutation({ mutationFn: () => api<void>('/api/auth/email-verifications', { method: 'POST', body: jsonBody({ token }) }) })
  useEffect(() => { if (token && verification.isIdle) verification.mutate() }, [token, verification])
  return <AuthLayout title={verification.isSuccess ? '인증이 완료됐어요' : '이메일을 확인하고 있어요'} description={verification.isSuccess ? '이제 로그인해서 돈독을 시작할 수 있어요.' : '잠시만 기다려 주세요.'}>{verification.isPending ? <LoaderCircle className="mx-auto animate-spin text-forest-700 dark:text-forest-100" size={38} /> : verification.isSuccess ? <StatusIcon icon={<CheckCircle2 size={30} />} /> : <ErrorMessage error={token ? verification.error : new Error('인증 링크에 필요한 정보가 없어요.')} />}<Button asChild size="large" className="mt-7 w-full"><Link to="/login">로그인</Link></Button></AuthLayout>
}

export function ForgotPasswordPage() {
  const reset = useMutation({ mutationFn: (email: string) => api<void>('/api/auth/password-resets', { method: 'POST', body: jsonBody({ email }) }) })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); reset.mutate(String(new FormData(event.currentTarget).get('email'))) }
  return <AuthLayout title="비밀번호 찾기" description="가입한 이메일로 30분 동안 유효한 재설정 링크를 보내드려요.">{reset.isSuccess ? <><StatusIcon icon={<Mail size={30} />} /><p className="mt-6 text-center text-sm leading-6 text-[var(--muted)]">가입된 이메일이라면 재설정 안내를 보냈어요.</p></> : <form className="grid gap-5" onSubmit={submit}><Field id="email" name="email" label="이메일" type="email" autoComplete="email" required autoFocus /><ErrorMessage error={reset.error} /><Button type="submit" size="large" disabled={reset.isPending}>재설정 메일 받기</Button></form>}<Button asChild variant="ghost" className="mt-5 w-full"><Link to="/login"><ArrowLeft size={17} />로그인으로 돌아가기</Link></Button></AuthLayout>
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [passwordError, setPasswordError] = useState<string>()
  const reset = useMutation({ mutationFn: (newPassword: string) => api<void>('/api/auth/password-resets/confirm', { method: 'POST', body: jsonBody({ token, newPassword }) }), onSuccess: () => setTimeout(() => navigate('/login', { replace: true }), 800) })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const password = String(data.get('password')); if (password !== String(data.get('confirm'))) { setPasswordError('비밀번호가 서로 달라요.'); return }; setPasswordError(undefined); reset.mutate(password) }
  return <AuthLayout title="새 비밀번호 설정" description="변경이 완료되면 모든 기기에서 다시 로그인해야 해요."><form className="grid gap-5" onSubmit={submit}><Field id="password" name="password" label="새 비밀번호" type="password" autoComplete="new-password" minLength={10} required /><Field id="confirm" name="confirm" label="새 비밀번호 확인" type="password" autoComplete="new-password" minLength={10} required error={passwordError} onChange={() => setPasswordError(undefined)} /><ErrorMessage error={!token ? new Error('재설정 링크에 필요한 정보가 없어요.') : reset.error} /><Button type="submit" size="large" disabled={!token || reset.isPending}>{reset.isSuccess ? '변경 완료' : '비밀번호 변경'}</Button></form></AuthLayout>
}

function StatusIcon({ icon }: { icon: ReactNode }) { return <div className="mx-auto grid size-16 place-items-center text-forest-700 dark:text-forest-100">{icon}</div> }

function safeNext(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}
