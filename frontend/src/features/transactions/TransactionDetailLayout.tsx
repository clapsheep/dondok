import { ArrowLeft, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarDays, ChevronDown, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { MemberAvatar } from '../../components/MemberAvatar'
import { Button } from '../../components/ui/Button'
import { formatDate, formatWon } from '../assets/format'
import type { Transaction } from './api'
import { transactionTypeLabel } from './transactionRow'
import { transactionReflection } from './transactionDetailPresentation'
import './transaction-detail.css'

export function TransactionDetailLayout({ title, returnTo, actions, children }: { title: string; returnTo: string; actions?: ReactNode; children: ReactNode }) {
  return <AppShell ledgerNavigation mobileHeader={{ title, backTo: returnTo, backLabel: '거래 목록으로', action: actions }}>
    <section className="td-page">
      <header className="td-heading"><Button asChild variant="ghost"><Link to={returnTo} aria-label="목록으로 돌아가기"><ArrowLeft size={17} />거래 내역</Link></Button><h1>{title}</h1>{actions}</header>
      {children}
    </section>
  </AppShell>
}

export function TransactionActionLink({ to, returnTo, label, icon: Icon }: { to: string; returnTo: string; label: string; icon: LucideIcon }) {
  return <Button asChild variant="ghost" size="icon" className="shrink-0 text-[var(--muted)]"><Link to={to} state={{ returnTo }} aria-label={label} title={label}><Icon size={20} aria-hidden="true" /></Link></Button>
}

export function TransactionDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="td-info-row"><dt>{label}</dt><dd>{value}</dd></div>
}

export function TransactionHero({ transaction }: { transaction: Transaction }) {
  const refund = transaction.managementType === 'CARD_REFUND'
  const Direction = refund || transaction.type === 'INCOME' ? ArrowDownLeft : transaction.type === 'TRANSFER' ? ArrowLeftRight : ArrowUpRight
  const prefix = refund || transaction.type === 'INCOME' ? '+' : transaction.type === 'EXPENSE' ? '-' : ''
  return <section className="td-hero" aria-label="거래 요약">
    <div className="td-eyebrow"><span><Direction size={15} aria-hidden="true"/>{transactionTypeLabel(transaction)}</span>
      {transaction.excludedFromStatistics ? <span>집계 제외</span> : transaction.type === 'EXPENSE' && !refund && transaction.statisticsAmountWon !== transaction.amountWon ? <span>대표 결제</span> : transaction.managementType === 'CARD_PURCHASE' ? <span>신용카드</span> : null}
    </div>
    <p className="td-amount">{prefix}{transaction.amountWon.toLocaleString('ko-KR')}<span>원</span></p>
    <h2>{transaction.description || transaction.category?.name || transactionTypeLabel(transaction)}</h2>
    <p className="td-date"><CalendarDays size={14} aria-hidden="true"/><time dateTime={transaction.occurredOn}>{formatDate(transaction.occurredOn)}</time></p>
  </section>
}

export function TransactionReflection({ transaction }: { transaction: Transaction }) {
  const { label, amount, note, representative } = transactionReflection(transaction)
  return <aside className="td-reflection" aria-label="집계 반영"><p>{label}</p><strong>{amount.toLocaleString('ko-KR')}<span>원</span></strong><p className="td-reflection-note">{note}</p>
    {representative ? <dl className="td-split"><div><dt>실제 결제</dt><dd>{formatWon(transaction.amountWon)}</dd></div><div><dt>내 부담</dt><dd>{formatWon(transaction.statisticsAmountWon)}</dd></div></dl> : null}
  </aside>
}

export function TransactionAudit({ transaction }: { transaction: Transaction }) {
  const timestamp = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  return <details className="td-disclosure td-audit"><summary><span>기록 정보</span><ChevronDown size={17} aria-hidden="true"/></summary><dl className="td-disclosure-body">
    <TransactionDetailRow label="기록한 사람" value={transaction.createdBy ? <><MemberAvatar displayName={transaction.createdBy.displayName} memberId={transaction.createdBy.memberId} size="xs"/>{transaction.createdBy.displayName}</> : '자동 기록'}/>
    <TransactionDetailRow label="작성 시각" value={<time dateTime={transaction.createdAt}>{timestamp(transaction.createdAt)}</time>}/>
    <TransactionDetailRow label="마지막 수정" value={<time dateTime={transaction.updatedAt}>{timestamp(transaction.updatedAt)}</time>}/>
  </dl></details>
}
