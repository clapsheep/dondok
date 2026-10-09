import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'
import { ApiError } from '../../lib/api'
import { assetApi, assetKeys } from '../assets/api'
import type { LedgerBook } from '../membership/api'
import { CardPaymentSection } from './CardPaymentSection'

export function CardPaymentPage({ ledger }: { ledger: LedgerBook }) {
  const { assetId = '' } = useParams()
  const backTo = `/assets/${assetId}`
  const asset = useQuery({
    queryKey: assetKeys.detail(assetId),
    queryFn: () => assetApi.detail(assetId),
    enabled: Boolean(assetId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const missing = asset.error instanceof ApiError && asset.error.status === 404

  if (asset.data && !missing && asset.data.behavior !== 'CREDIT_CARD') return <Navigate to={backTo} replace />

  return (
    <AppShell ledgerNavigation mobileHeader={{ title: '카드 대금 결제', backTo, backLabel: '카드 자산으로 돌아가기' }}>
      <section className="mx-auto max-w-[52rem] py-4 md:py-8">
        <Button asChild className="mb-3 hidden md:inline-flex" variant="ghost"><Link to={backTo}><ArrowLeft size={17} />카드 자산으로 돌아가기</Link></Button>
        <header>
          <h1 className="hidden text-2xl font-semibold tracking-[-.025em] md:block">카드 대금 결제</h1>
          {asset.data && !missing ? <p className="text-sm text-[var(--muted)] md:mt-2">{asset.data.name}</p> : null}
        </header>
        {asset.isPending ? <p className="py-12 text-sm text-[var(--muted)]" role="status">카드 정보를 불러오는 중…</p>
          : missing || !asset.data ? <div className="py-8" role="alert">
            <p>{missing ? '카드를 찾을 수 없어요. 삭제되었거나 주소가 올바르지 않을 수 있어요.' : '카드 정보를 불러오지 못했어요.'}</p>
            {missing ? <Button asChild className="mt-4" variant="secondary"><Link to="/assets">자산 목록</Link></Button> : <Button className="mt-4" variant="secondary" onClick={() => asset.refetch()}>다시 불러오기</Button>}
          </div> : <>
            {asset.isError ? <p className="mt-4 text-sm text-[var(--muted)]" role="alert">최신 카드 정보를 불러오지 못했어요.<Button variant="ghost" onClick={() => asset.refetch()}>다시 불러오기</Button></p> : null}
            <CardPaymentSection key={asset.data.assetId} asset={asset.data} members={ledger.members} />
          </>}
      </section>
    </AppShell>
  )
}
