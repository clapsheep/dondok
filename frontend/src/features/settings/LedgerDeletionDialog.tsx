import { useMutation } from '@tanstack/react-query'
import { LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { membershipApi, type CurrentLedgerBook, type LedgerBook } from '../membership/api'
import {
  isLedgerDeletionConfirmed,
  LEDGER_DELETION_CONFIRMATION_PHRASE,
  snapshotLedger,
  type LedgerExitReason,
} from '../membership/ledgerLifecycle'

export type LedgerDeletionOutcome = { current: CurrentLedgerBook; reason: LedgerExitReason }

export function LedgerDeletionDialog({ initialLedger, onRequestClose, onResolved }: {
  initialLedger: LedgerBook
  onRequestClose: () => void
  onResolved: (outcome: LedgerDeletionOutcome) => void
}) {
  const online = useOnlineStatus()
  const heading = useRef<HTMLHeadingElement | null>(null)
  const conflictAlert = useRef<HTMLDivElement | null>(null)
  const historyMarker = useRef(crypto.randomUUID())
  const pendingOutcome = useRef<LedgerDeletionOutcome | undefined>(undefined)
  const deletionPending = useRef(false)
  const mounted = useRef(true)
  const [snapshot, setSnapshot] = useState(() => snapshotLedger(initialLedger))
  const [phrase, setPhrase] = useState('')
  const [conflict, setConflict] = useState(false)
  const [checkingCurrent, setCheckingCurrent] = useState(false)
  const [reconcileError, setReconcileError] = useState<string>()
  const remove = useMutation({
    mutationFn: () => membershipApi.deleteCurrent({
      expectedLedgerId: snapshot.ledgerId,
      expectedVersion: snapshot.version,
      confirmationPhrase: LEDGER_DELETION_CONFIRMATION_PHRASE,
    }),
    onMutate: () => {
      deletionPending.current = true
      setReconcileError(undefined)
    },
    onSuccess: () => {
      deletionPending.current = false
      pendingOutcome.current = { current: { ledger: null }, reason: 'DELETED' }
      requestClose()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 412) setConflict(true)
      else if (error instanceof ApiError && error.status === 404) void reconcileCurrent('MISSING')
    },
    onSettled: () => { deletionPending.current = false },
  })

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!conflict) return
    requestAnimationFrame(() => conflictAlert.current?.focus())
  }, [conflict])

  useEffect(() => {
    const currentHistoryState = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {}
    if (currentHistoryState.dondokLedgerDeletionDialog !== historyMarker.current) {
      window.history.pushState({ ...currentHistoryState, dondokLedgerDeletionDialog: historyMarker.current }, '', window.location.href)
    }
    requestAnimationFrame(() => heading.current?.focus())
    const handlePopState = () => {
      if (deletionPending.current) {
        const currentState = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {}
        window.history.pushState({ ...currentState, dondokLedgerDeletionDialog: historyMarker.current }, '', window.location.href)
        return
      }
      const outcome = pendingOutcome.current
      pendingOutcome.current = undefined
      onRequestClose()
      if (outcome) onResolved(outcome)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [onRequestClose, onResolved])

  function requestClose() {
    if (window.history.state?.dondokLedgerDeletionDialog === historyMarker.current) {
      window.history.back()
      return
    }
    const outcome = pendingOutcome.current
    pendingOutcome.current = undefined
    onRequestClose()
    if (outcome) onResolved(outcome)
  }

  function queueOutcome(outcome: LedgerDeletionOutcome) {
    pendingOutcome.current = outcome
    requestClose()
  }

  async function reconcileCurrent(reason: 'CONFLICT' | 'MISSING') {
    setCheckingCurrent(true)
    setReconcileError(undefined)
    try {
      const current = await membershipApi.current()
      if (!mounted.current) return
      if (!current.ledger) {
        queueOutcome({ current, reason: 'DELETED_REMOTELY' })
        return
      }
      if (current.ledger.ledgerId !== snapshot.ledgerId) {
        queueOutcome({ current, reason: 'LEDGER_CHANGED' })
        return
      }
      if (reason === 'MISSING') {
        setReconcileError('가계부 삭제 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      setSnapshot(snapshotLedger(current.ledger))
      setConflict(false)
      remove.reset()
    } catch (error) {
      if (!mounted.current) return
      setReconcileError(error instanceof Error ? error.message : '최신 가계부 정보를 확인하지 못했어요.')
    } finally {
      if (mounted.current) setCheckingCurrent(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || conflict || !isLedgerDeletionConfirmed(phrase)) return
    remove.mutate()
  }

  const ordinaryError = remove.error instanceof ApiError && [404, 412].includes(remove.error.status) ? null : remove.error

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !remove.isPending) requestClose() }}>
    <DialogContent
      className="left-1/2 top-auto bottom-[max(.5rem,env(safe-area-inset-bottom))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] w-[calc(100vw-2rem)] -translate-x-1/2 translate-y-0 md:top-1/2 md:bottom-auto md:w-[min(36rem,calc(100vw-3rem))] md:-translate-y-1/2"
      aria-labelledby="ledger-deletion-dialog-title"
      aria-describedby="ledger-deletion-dialog-description"
      initialFocus={heading}
    >
      <form className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6" onSubmit={submit}>
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <DialogTitle ref={heading} id="ledger-deletion-dialog-title" className="outline-none" tabIndex={-1}>가계부 삭제</DialogTitle>
            <DialogDescription id="ledger-deletion-dialog-description" className="mt-2">가계부 데이터는 삭제되지만 구성원의 돈독 계정과 로그인은 유지됩니다.</DialogDescription>
          </div>
          <Button className="shrink-0" type="button" size="icon" variant="ghost" aria-label="가계부 삭제 닫기" disabled={remove.isPending} onClick={requestClose}><X size={19} /></Button>
        </header>

        <div className="py-5">
          <p className="font-semibold leading-6">모든 구성원과 자산·거래·분류·카드 결제 기록·초대가 함께 영구 삭제됩니다.</p>
          <div className="mt-4 border-y border-[var(--line)] py-3">
            <p className="text-sm font-semibold">영향받는 구성원 {snapshot.members.length}명</p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--muted)]" aria-label="가계부 삭제 영향 구성원">
              {snapshot.members.map((member) => <li key={member.memberId}>{member.displayName}{member.currentUser ? ' (나)' : ''}</li>)}
            </ul>
          </div>

          <div className="mt-5">
            <Field
              id="ledgerDeletionPhrase"
              name="confirmationPhrase"
              label="확인 문구"
              value={phrase}
              onChange={(event) => { setPhrase(event.target.value); remove.reset() }}
              disabled={remove.isPending || checkingCurrent}
              autoComplete="off"
              spellCheck={false}
              hint={`계속하려면 ‘${LEDGER_DELETION_CONFIRMATION_PHRASE}’를 정확히 입력해 주세요.`}
            />
          </div>

          {conflict ? (
            <div ref={conflictAlert} className="mt-5 border-l-4 border-amber-500 px-4 py-2 outline-none" role="alert" tabIndex={-1}>
              <p className="font-semibold">가계부가 변경됐어요</p>
              <p className="mt-1 text-sm leading-6">입력한 확인 문구는 그대로 두었습니다. 최신 구성원 정보를 확인한 뒤 다시 삭제해 주세요.</p>
              <Button className="mt-3" type="button" variant="secondary" disabled={checkingCurrent || !online} onClick={() => void reconcileCurrent('CONFLICT')}>{checkingCurrent ? <LoaderCircle className="animate-spin" size={17} /> : <RotateCcw size={17} />}최신 내용 다시 확인</Button>
            </div>
          ) : null}
          {!online ? <p className="mt-5 border-l-4 border-amber-500 px-4 py-2 text-sm" role="status">오프라인 상태예요. 연결되면 입력을 유지한 채 삭제할 수 있어요.</p> : null}
          {reconcileError ? <p className="mt-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{reconcileError}</p> : null}
          {ordinaryError ? <p className="mt-5 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{ordinaryError instanceof Error ? ordinaryError.message : '가계부를 삭제하지 못했어요.'} 확인 문구는 그대로 두었습니다.</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-4 sm:flex sm:justify-end">
          <Button type="button" variant="secondary" disabled={remove.isPending} onClick={requestClose}>취소</Button>
          {!conflict ? <Button type="submit" variant="destructive" disabled={!online || !isLedgerDeletionConfirmed(phrase) || remove.isPending || checkingCurrent}>{remove.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}영구 삭제</Button> : null}
        </div>
      </form>
    </DialogContent>
    </Dialog>
  )
}
