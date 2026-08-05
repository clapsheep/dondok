import { UsersRound } from 'lucide-react'
import { MemberAvatar } from '../../components/MemberAvatar'
import type { LedgerBook } from './api'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

export function MemberList({ ledger }: { ledger: LedgerBook }) {
  return (
    <section className="min-w-0 lg:pr-8" aria-labelledby="members-title">
      <div className="flex items-center gap-3">
        <UsersRound className="shrink-0 text-forest-700 dark:text-forest-100" size={24} aria-hidden="true" />
        <div><h2 id="members-title" className="text-xl font-semibold">구성원</h2><p className="text-sm text-[var(--muted)]">로그인 아이디와 이메일은 공유하지 않아요.</p></div>
      </div>
      <ul className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {ledger.members.map((member) => (
          <li key={member.memberId} className="flex min-h-14 items-center justify-between gap-3 px-1 py-3">
            <span className="flex min-w-0 items-center gap-3"><MemberAvatar displayName={member.displayName} memberId={member.memberId} size="md" /><span className="truncate font-semibold">{member.displayName}</span></span>
            <span className="shrink-0 text-xs text-[var(--muted)]">{member.currentUser ? '나' : `${dateTime.format(new Date(member.joinedAt))} 참여`}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
