import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, UsersRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { membershipApi, membershipKeys } from './api'

const expiryFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' })
const directCodePattern = /^\d{6}$/

export function JoinPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const code = params.get('code')?.trim() ?? ''
  const [draftCode, setDraftCode] = useState(directCodePattern.test(code) ? code : '')
  const preview = useQuery({
    queryKey: ['ledger', 'invitation-preview', code],
    queryFn: () => membershipApi.previewInvitation(code),
    enabled: Boolean(code),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const redeem = useMutation({
    mutationFn: () => membershipApi.redeemInvitation(code),
    onSuccess: (ledger) => {
      queryClient.setQueryData(membershipKeys.current, { ledger })
      queryClient.removeQueries({ queryKey: ['ledger', 'invitation-preview'] })
      navigate('/', { replace: true })
    },
  })

  function checkCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (directCodePattern.test(draftCode)) navigate(`/join?code=${draftCode}`, { replace: true })
  }

  function updateDirectCode(value: string) {
    setDraftCode(value.replace(/\D/g, '').slice(0, 6))
  }

  const codeField = (autoFocus = false) => (
    <Field
      id="joinCode"
      name="joinCode"
      label="6자리 초대 코드"
      value={draftCode}
      onChange={(event) => updateDirectCode(event.target.value)}
      inputMode="numeric"
      pattern="[0-9]{6}"
      maxLength={6}
      autoComplete="one-time-code"
      placeholder="000000"
      className="text-center font-mono text-xl font-semibold tabular-nums tracking-[.3em]"
      required
      autoFocus={autoFocus}
    />
  )

  return (
    <AppShell>
      <section className="mx-auto max-w-2xl py-8 md:py-14">
        <Button asChild variant="ghost"><Link to="/"><ArrowLeft size={17} />돌아가기</Link></Button>
        <div className="mt-4 border-y border-[var(--line)] py-8 md:py-10">
          {!code ? (
            <form onSubmit={checkCode}>
              <p className="text-sm font-semibold text-brass-500">가계부 참여</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-.035em]">받은 초대를 확인해요</h1>
              <p className="mt-3 text-[var(--muted)]">받은 숫자 6자리를 입력하면 참여하기 전에 현재 구성원을 확인할 수 있어요.</p>
              <div className="mt-7">{codeField(true)}</div>
              <Button type="submit" className="mt-5 w-full" size="large" disabled={!directCodePattern.test(draftCode)}>초대 확인하기</Button>
            </form>
          ) : preview.isPending ? (
            <div className="grid min-h-72 place-items-center text-center"><div><LoaderCircle className="mx-auto animate-spin text-forest-600 dark:text-forest-100" size={36} /><p className="mt-4 text-sm text-[var(--muted)]">초대를 확인하는 중…</p></div></div>
          ) : preview.isError ? (
            <form onSubmit={checkCode}>
              <p className="text-sm font-semibold text-brass-500">초대를 확인할 수 없어요</p>
              <h1 className="mt-2 text-2xl font-semibold">코드가 만료됐거나 이미 사용됐어요</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">초대한 구성원에게 새 코드를 요청하거나 다른 코드를 입력해 주세요.</p>
              <p className="mt-4 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{preview.error instanceof Error ? preview.error.message : '초대를 확인하지 못했어요.'}</p>
              <div className="mt-6">{codeField()}</div>
              <Button type="submit" className="mt-5 w-full" variant="secondary" size="large" disabled={!directCodePattern.test(draftCode)}>다시 확인하기</Button>
            </form>
          ) : preview.data ? (
            <div>
              <UsersRound className="text-forest-700 dark:text-forest-100" size={28} aria-hidden="true" />
              <p className="mt-6 text-sm font-semibold text-brass-500">초대받은 가계부</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-.035em]">가계부 초대</h1>
              <p className="mt-3 text-sm text-[var(--muted)]">현재 구성원 {preview.data.memberCount}명 · {expiryFormat.format(new Date(preview.data.expiresAt))}까지</p>
              <div className="mt-6">
                <h2 className="text-sm font-semibold">함께 기록할 구성원</h2>
                <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{preview.data.memberNames.map((name, index) => <li key={`${name}-${index}`} className="flex min-h-12 items-center gap-2.5 px-1 py-2.5 text-sm font-semibold"><MemberAvatar displayName={name} memberId={`${name}-${index}`} /><span>{name}</span></li>)}</ul>
              </div>
              {redeem.error ? <p className="mt-4 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{redeem.error instanceof Error ? redeem.error.message : '가계부에 참여하지 못했어요.'}</p> : null}
              <div className="mt-7 grid gap-3 xs:grid-cols-2">
                <Button asChild variant="secondary" size="large"><Link to="/">취소</Link></Button>
                <Button size="large" onClick={() => redeem.mutate()} disabled={redeem.isPending}>{redeem.isPending && <LoaderCircle className="animate-spin" size={18} />}참여하기</Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  )
}
