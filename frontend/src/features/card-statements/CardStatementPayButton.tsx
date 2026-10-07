import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/Dialog'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { assetKeys } from '../assets/api'
import { formatDate, formatWon } from '../assets/format'
import { transactionKeys } from '../transactions/api'
import { cardStatementApi, cardStatementKeys, type ManualCardPaymentInput } from './api'

export function CardStatementPayButton({ statementId, disabled = false, onPaid }: { statementId: string; disabled?: boolean; onPaid?: (amountWon: number) => void }) {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState<{ input: ManualCardPaymentInput; key: string } | null>(null)
  const online = useOnlineStatus()
  const client = useQueryClient()
  const detail = useQuery({
    queryKey: cardStatementKeys.detail(statementId),
    queryFn: () => cardStatementApi.detail(statementId),
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const payment = useMutation({
    mutationFn: (request: { input: ManualCardPaymentInput; key: string }) => cardStatementApi.payManually(statementId, request.input, request.key),
    onSuccess: async (result) => {
      client.setQueryData(cardStatementKeys.detail(statementId), result.statement)
      setOpen(false)
      setAttempt(null)
      onPaid?.(result.payment.amountWon)
      await Promise.all([
        client.invalidateQueries({ queryKey: cardStatementKeys.all }),
        client.invalidateQueries({ queryKey: assetKeys.all }),
        client.invalidateQueries({ queryKey: transactionKeys.all }),
      ])
    },
  })
  const statement = detail.data
  const conflict = payment.error instanceof ApiError && [409, 412].includes(payment.error.status)
  const payable = statement && ['OPEN', 'FINALIZED'].includes(statement.status) && statement.remainingAmountWon > 0 && statement.settlementAsset

  function pay() {
    if (!payable || !statement.settlementAsset) return
    const request = attempt ?? { input: {
      expectedVersion: statement.version,
      expectedAmountWon: statement.remainingAmountWon,
      settlementAssetId: statement.settlementAsset.assetId,
    }, key: crypto.randomUUID() }
    setAttempt(request)
    payment.mutate(request)
  }

  async function reload() {
    const result = await detail.refetch()
    if (!result.isError) {
      setAttempt(null)
      payment.reset()
    }
  }

  return <>
    <Button type="button" disabled={disabled || !online} onClick={() => { setAttempt(null); payment.reset(); setOpen(true) }}>결제하기</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!payment.isPending) setOpen(value) }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>미결제 대금 결제</DialogTitle><DialogDescription>남은 금액 전액을 오늘 날짜로 결제 기록해요. 실제 은행 이체는 별도로 진행해 주세요.</DialogDescription></DialogHeader>
        {detail.isPending || detail.isFetching ? <p className="mt-4 flex items-center gap-2" role="status"><LoaderCircle className="animate-spin" size={16} />최신 결제 내역을 확인하는 중…</p> : detail.isError ? <div className="mt-4" role="alert"><p>결제 내역을 불러오지 못했어요.</p><Button className="mt-3" variant="secondary" onClick={reload}>다시 불러오기</Button></div> : statement ? <>
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt>카드</dt><dd className="break-words text-right font-semibold">{statement.cardAsset.name}</dd>
            <dt>결제 예정일</dt><dd className="text-right">{formatDate(statement.dueOn)}</dd>
            <dt>결제 계좌</dt><dd className="break-words text-right">{statement.settlementAsset?.name ?? '설정 필요'}</dd>
            <dt>결제 금액</dt><dd className="text-right text-lg font-semibold tabular-nums">{formatWon(statement.remainingAmountWon)}</dd>
          </dl>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">결제 계좌에서 카드로 자산을 이동하며 수입·지출 합계에는 포함하지 않아요.</p>
          {!payable ? <p className="mt-3 text-sm" role="status">현재 결제할 미결제 금액이 없거나 결제 계좌 설정이 필요해요.</p> : null}
        </> : null}
        {payment.error ? <div className="mt-4 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert"><p>{conflict ? '결제 상태가 변경됐거나 처리 중이에요. 최신 내용을 확인한 뒤 다시 진행해 주세요.' : payment.error.message}</p>{conflict ? <Button className="mt-3" variant="secondary" disabled={detail.isFetching} onClick={reload}>최신 내용 확인</Button> : null}</div> : null}
        {!online ? <p className="mt-3 text-sm" role="status">인터넷에 연결한 뒤 결제할 수 있어요.</p> : null}
        <DialogFooter className="mt-6"><Button variant="secondary" disabled={payment.isPending} onClick={() => setOpen(false)}>닫기</Button><Button disabled={!online || !payable || detail.isFetching || detail.isError || payment.isPending || conflict} onClick={pay}>{payment.isPending ? <LoaderCircle className="animate-spin" size={16} /> : null}전액 결제 기록</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
