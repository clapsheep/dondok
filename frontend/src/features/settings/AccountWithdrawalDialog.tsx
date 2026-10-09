import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { ApiError, api, clearCsrfToken, jsonBody } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { membershipApi, membershipKeys, type LedgerBook } from '../membership/api'

export function AccountWithdrawalDialog({ ledger, onClose }: { ledger: LedgerBook | null; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(ledger)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [conflict, setConflict] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const solo = snapshot !== null && snapshot.members.filter((member) => !member.withdrawn).length === 1
  const refresh = useMutation({
    mutationFn: membershipApi.current,
    onSuccess: (current) => {
      setSnapshot(current.ledger)
      setConfirmed(false)
      setConflict(false)
      remove.reset()
      queryClient.setQueryData(membershipKeys.current, current)
    },
  })
  const remove = useMutation({
    mutationFn: () => api<void>('/api/auth/me', {
      method: 'DELETE',
      body: jsonBody({ password, confirmed, expectedLedgerId: snapshot?.ledgerId ?? null, expectedVersion: snapshot?.version ?? null }),
    }),
    onSuccess: async () => {
      // Cancel reads before clearing so an in-flight response cannot restore private data.
      await queryClient.cancelQueries()
      clearCsrfToken()
      clearWithdrawalPreferences(snapshot)
      queryClient.clear()
      navigate('/login?withdrawn=1', { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 412) { setConflict(true); setConfirmed(false) }
      if (error instanceof ApiError && error.status === 401) {
        clearCsrfToken()
        queryClient.clear()
        navigate('/login', { replace: true })
      }
    },
  })
  const busy = remove.isPending || refresh.isPending
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy && online && confirmed && password && !conflict) remove.mutate()
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-w-lg">
      <div className="flex items-start justify-between gap-3">
        <DialogTitle>돈독을 탈퇴하시겠어요?</DialogTitle>
        <Button variant="ghost" size="icon" aria-label="닫기" disabled={busy} onClick={onClose}><X size={18} /></Button>
      </div>
      <DialogDescription className="mt-3">탈퇴하면 모든 기기에서 로그아웃되며 이 계정으로 다시 로그인할 수 없어요.</DialogDescription>
      <form onSubmit={submit} className="mt-5 grid gap-5">
        <div className="rounded-lg bg-red-50 p-4 text-sm dark:bg-red-950/30">
          <p className="font-semibold text-red-800 dark:text-red-200">{solo ? '혼자 쓰는 가계부도 함께 삭제돼요' : snapshot ? '함께 쓴 가계부는 남아요' : '돈독 계정이 삭제돼요'}</p>
          <p className="mt-2 leading-6">{solo ? '마지막 구성원이므로 자산과 거래를 포함한 가계부 전체가 삭제돼요. 되돌릴 수 없어요.' : snapshot ? '다른 구성원은 가계부를 계속 사용할 수 있어요. 금액과 잔액·정산 기록은 유지되고 내 작성자·사용주체·명의는 ‘탈퇴한 구성원’으로 표시돼요.' : '현재 참여 중인 가계부가 없어 삭제할 가계부 기록은 없어요.'}</p>
        </div>
        <p className="text-xs leading-5 text-[var(--muted)]">계정·인증정보·로그인 세션·가입 동의 기록을 삭제해요. 관련 거래 설명과 자산 이름·메모, 사용자 지정 분류 이름도 정리해요. 남아 있는 금액·날짜와 공동 이용 맥락으로 상대방이 누군지 알 수는 있어요.</p>
        <Field id="withdrawal-password" label="현재 비밀번호" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} required disabled={busy} />
        <label className="flex min-h-11 items-start gap-3 text-sm"><Checkbox className="mt-1" checked={confirmed} onCheckedChange={setConfirmed} disabled={busy || conflict} /><span>{solo ? '계정과 가계부 전체가 삭제됨을 확인했어요.' : '계정 탈퇴와 기록 처리 내용을 확인했어요.'}</span></label>
        {!online ? <p role="alert" className="text-sm text-[var(--muted)]">인터넷 연결 후 탈퇴할 수 있어요. 입력한 내용은 유지됩니다.</p> : null}
        {remove.error || refresh.error ? <p role="alert" className="text-sm text-red-800 dark:text-red-200">{(refresh.error ?? remove.error)?.message}</p> : null}
        {conflict ? <Button type="button" variant="secondary" disabled={busy || !online} onClick={() => refresh.mutate()}>최신 내용 다시 확인</Button> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>취소</Button>
          <Button type="submit" variant="destructive" disabled={busy || !online || conflict || !confirmed || !password}>{remove.isPending ? <LoaderCircle size={17} className="animate-spin" /> : null}{solo ? '탈퇴하고 가계부 삭제' : '회원 탈퇴'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}

function clearWithdrawalPreferences(ledger: LedgerBook | null) {
  const member = ledger?.members.find((candidate) => candidate.currentUser)
  if (!ledger || !member) return
  try {
    const scope = `${ledger.ledgerId}:${member.memberId}`
    localStorage.removeItem(`dondok-last-transaction-date-v1:${scope}`)
    const key = 'dondok-last-expense-asset-v1'
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as { byScope?: Record<string, string> }
    if (value.byScope) {
      delete value.byScope[scope]
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch { /* A blocked browser store must not prevent successful withdrawal. */ }
}
