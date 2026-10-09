import { StepIndicator } from '../../components/ui/StepIndicator'
import { Checkbox } from '../../components/ui/Checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/Dialog'
import { LegalText } from '../legal/LegalPages'
import { useLegalDocuments, type SignUpConsent } from '../legal/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, LoaderCircle, Mail } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError, api, jsonBody, type SessionUser } from '../../lib/api'
import { AuthLayout } from './AuthLayout'

function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="ui-notice text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : '요청을 처리하지 못했어요.'}</p>
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
        {params.get('passwordChanged') === '1' ? <p role="status" className="text-sm text-forest-700 dark:text-forest-100">비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요.</p> : null}
        {params.get('withdrawn') === '1' ? <p role="status" className="text-sm text-forest-700 dark:text-forest-100">회원 탈퇴가 완료됐어요.</p> : null}
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
  const [step, setStep] = useState(1)
  const formRef = useRef<HTMLFormElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const stepFocusPending = useRef(false)
  function moveStep(next: number) { stepFocusPending.current = true; setStep(next) }
  useLayoutEffect(() => {
    if (stepFocusPending.current) {
      stepFocusPending.current = false
      progressRef.current?.focus()
    }
  }, [step])
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [checkedId, setCheckedId] = useState('')
  const [checkingId, setCheckingId] = useState(false)
  const [idError, setIdError] = useState<string>()
  const [passwordError, setPasswordError] = useState<string>()
  const documents = useLegalDocuments()
  const [age14OrOlder, setAge14OrOlder] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [openDocument, setOpenDocument] = useState<'terms' | 'collection' | null>(null)
  const signUp = useMutation({
    mutationFn: (body: { loginId: string; displayName: string; email: string; password: string; consent: SignUpConsent }) => api<{ email: string }>('/api/auth/sign-up', { method: 'POST', body: jsonBody(body) }),
    onError: (error) => {
      if (error instanceof ApiError && error.errorCode === 'LOGIN_ID_ALREADY_EXISTS') moveStep(2)
      if (error instanceof ApiError && error.errorCode === 'EMAIL_ALREADY_EXISTS') moveStep(1)
      if (error instanceof ApiError && error.errorCode === 'SIGNUP_CONSENT_VERSION_CHANGED') {
        setTermsAccepted(false); setPrivacyAccepted(false)
        setConsentError(error.message)
        void documents.refetch()
      }
    },
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

  function validatePanel(panel: number) {
    const inputs = formRef.current?.querySelectorAll<HTMLInputElement>(`[data-signup-step="${panel}"] input`) ?? []
    for (const input of inputs) { if (!input.checkValidity()) { moveStep(panel); requestAnimationFrame(() => input.reportValidity()); return false } }
    if (panel === 2 && formRef.current) {
      const data = new FormData(formRef.current)
      if (checkedId !== String(data.get('loginId'))) { setIdError('아이디 중복 확인을 먼저 해 주세요.'); moveStep(2); return false }
      if (data.get('password') !== data.get('passwordConfirm')) { setPasswordError('비밀번호가 서로 달라요.'); moveStep(2); return false }
      setPasswordError(undefined)
    }
    return true
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (signUp.isPending) return
    if (!validatePanel(step)) return
    if (step < 3) { moveStep(step + 1); return }
    if (!validatePanel(1) || !validatePanel(2)) return
    if (!documents.data || !age14OrOlder || !termsAccepted || !privacyAccepted) { setConsentError('만 14세 이상 확인과 필수 동의를 완료해 주세요.'); return }
    setConsentError('')
    const data = new FormData(event.currentTarget)
    signUp.mutate({ loginId: String(data.get('loginId')), displayName: String(data.get('displayName')), email: String(data.get('email')), password: String(data.get('password')),
      consent: { version: documents.data.version, age14OrOlder, termsAccepted, privacyAccepted } })
  }

  return (
    <AuthLayout eyebrow="차곡차곡 시작하기" title="돈독 회원가입" description="가입 후 이메일을 확인하면 함께 쓸 가계부를 만들 수 있어요.">
      <div className="auth-progress" ref={progressRef} tabIndex={-1}><span>{['기본 정보','로그인 정보','필수 동의'][step - 1]}</span><StepIndicator step={step} label="가입 진행" /></div>
      <form ref={formRef} className="grid gap-4" onSubmit={submit} noValidate>
        <div data-signup-step="1" hidden={step !== 1}>
          <Field id="displayName" name="displayName" label="이름" autoComplete="name" maxLength={100} required />
          <Field id="email" name="email" label="이메일" type="email" autoComplete="email" required />
        </div>
        <div data-signup-step="2" hidden={step !== 2}>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field id="loginId" name="loginId" label="아이디" autoComplete="username" minLength={4} maxLength={30} required onChange={() => { setCheckedId(''); setIdError(undefined) }} error={idError} />
          <Button type="button" variant="secondary" className="mb-[1px]" disabled={checkingId} onClick={(event) => checkLoginId(event.currentTarget.form!)}>{checkedId ? '확인 완료' : checkingId ? '확인 중' : '중복 확인'}</Button>
        </div>
        <Field id="password" name="password" label="비밀번호" type="password" autoComplete="new-password" minLength={10} maxLength={128} required hint="10자 이상 입력해 주세요." />
        <Field id="passwordConfirm" name="passwordConfirm" label="비밀번호 확인" type="password" autoComplete="new-password" minLength={10} maxLength={128} required error={passwordError} onChange={() => setPasswordError(undefined)} />
        </div>
        <div data-signup-step="3" hidden={step !== 3}>
        <fieldset className="auth-consents grid gap-2" disabled={!documents.data || documents.isFetching || signUp.isPending}>
          <legend className="mb-2 text-sm font-semibold">필수 확인 및 동의</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={age14OrOlder} onCheckedChange={setAge14OrOlder} />[필수] 만 14세 이상입니다</label>
          <div className="flex items-center justify-between gap-2"><label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={termsAccepted} onCheckedChange={setTermsAccepted} />[필수] 이용약관 동의</label><Button variant="ghost" type="button" aria-label="이용약관 내용 보기" onClick={() => setOpenDocument('terms')}>보기</Button></div>
          <div className="flex items-center justify-between gap-2"><label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={privacyAccepted} onCheckedChange={setPrivacyAccepted} />[필수] 개인정보 수집·이용 동의</label><Button variant="ghost" type="button" aria-label="개인정보 수집·이용 내용 보기" onClick={() => setOpenDocument('collection')}>보기</Button></div>
          {documents.data ? <p className="text-xs leading-5 text-[var(--muted)]">{documents.data.collection.split('\n\n')[1]}</p> : null}
        </fieldset>
        {documents.isPending ? <p role="status" className="text-sm">약관을 불러오고 있어요.</p> : null}
        {documents.isError ? <div role="alert"><p>약관을 불러오지 못했어요.</p><Button type="button" variant="secondary" onClick={() => void documents.refetch()}>약관 다시 불러오기</Button></div> : null}
        {consentError ? <p role="alert" className="text-sm text-red-800 dark:text-[#ffd5cf]">{consentError}</p> : null}
        </div>
        <ErrorMessage error={signUp.error instanceof ApiError && ['LOGIN_ID_ALREADY_EXISTS', 'EMAIL_ALREADY_EXISTS'].includes(signUp.error.errorCode ?? '') ? new Error('아이디 또는 이메일이 이미 사용 중이에요.') : signUp.error} />
        <div className="auth-actions">{step > 1 ? <Button type="button" variant="ghost" aria-label="이전 가입 단계" disabled={signUp.isPending} onClick={() => moveStep(step - 1)}><ArrowLeft size={18} /></Button> : null}<Button type="submit" size="large" disabled={signUp.isPending || (step === 3 && (!documents.data || documents.isFetching))}>{signUp.isPending ? <LoaderCircle className="animate-spin" size={18} /> : null}{step === 3 ? '가입하고 인증 메일 받기' : '다음'}</Button></div>
      </form>
      <Dialog open={openDocument !== null} onOpenChange={(open) => { if (!open) setOpenDocument(null) }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{openDocument === 'terms' ? '이용약관' : '개인정보 수집·이용 동의'}</DialogTitle><DialogDescription>내용을 확인한 후 회원가입 화면에서 동의해 주세요.</DialogDescription></DialogHeader>
          {documents.data && openDocument ? <LegalText text={documents.data[openDocument]} /> : null}
        </DialogContent>
      </Dialog>
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
  const verification = useQuery({
    queryKey: ['email-verification', token],
    queryFn: async () => {
      await api<void>('/api/auth/email-verifications', { method: 'POST', body: jsonBody({ token }) })
      return true
    },
    enabled: Boolean(token),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return <AuthLayout title={verification.isSuccess ? '인증이 완료됐어요' : '이메일을 확인하고 있어요'} description={verification.isSuccess ? '이제 로그인해서 돈독을 시작할 수 있어요.' : '잠시만 기다려 주세요.'}>{!token ? <ErrorMessage error={new Error('인증 링크에 필요한 정보가 없어요.')} /> : verification.isPending ? <LoaderCircle className="mx-auto animate-spin text-forest-700 dark:text-forest-100" size={38} /> : verification.isSuccess ? <StatusIcon icon={<CheckCircle2 size={30} />} /> : <ErrorMessage error={verification.error} />}<Button asChild size="large" className="mt-7 w-full"><Link to="/login">로그인</Link></Button></AuthLayout>
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
  return <AuthLayout title="새 비밀번호 설정" description="변경이 완료되면 모든 기기에서 다시 로그인해야 해요."><form className="grid gap-5" onSubmit={submit}><Field id="password" name="password" label="새 비밀번호" type="password" autoComplete="new-password" minLength={10} required /><Field id="confirm" name="confirm" label="새 비밀번호 확인" type="password" autoComplete="new-password" minLength={10} maxLength={128} required error={passwordError} onChange={() => setPasswordError(undefined)} /><ErrorMessage error={!token ? new Error('재설정 링크에 필요한 정보가 없어요.') : reset.error} /><Button type="submit" size="large" disabled={!token || reset.isPending}>{reset.isSuccess ? '변경 완료' : '비밀번호 변경'}</Button></form></AuthLayout>
}

function StatusIcon({ icon }: { icon: ReactNode }) { return <div className="mx-auto grid size-16 place-items-center text-forest-700 dark:text-forest-100">{icon}</div> }

function safeNext(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}
