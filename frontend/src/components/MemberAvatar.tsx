import { UsersRound } from 'lucide-react'
import { cn } from '../lib/cn'
import { memberAvatarTone, memberInitial } from './avatarIdentity'

type AvatarSize = 'xs' | 'sm' | 'md'

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'size-5 text-[0.625rem]',
  sm: 'size-7 text-xs',
  md: 'size-8 text-sm',
}

const toneClasses = [
  'bg-[var(--member-avatar-1-bg)] text-[var(--member-avatar-1-fg)]',
  'bg-[var(--member-avatar-2-bg)] text-[var(--member-avatar-2-fg)]',
  'bg-[var(--member-avatar-3-bg)] text-[var(--member-avatar-3-fg)]',
  'bg-[var(--member-avatar-4-bg)] text-[var(--member-avatar-4-fg)]',
  'bg-[var(--member-avatar-5-bg)] text-[var(--member-avatar-5-fg)]',
  'bg-[var(--member-avatar-6-bg)] text-[var(--member-avatar-6-fg)]',
] as const

export function MemberAvatar({ displayName, memberId, size = 'sm', className }: {
  displayName: string
  memberId?: string
  size?: AvatarSize
  className?: string
}) {
  const tone = memberAvatarTone(memberId || displayName)
  const initial = memberInitial(displayName)
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none', sizeClasses[size], toneClasses[tone], className)}
      data-member-avatar
      data-member-initial={initial}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

export function JointAvatar({ size = 'sm', className }: { size?: AvatarSize; className?: string }) {
  const iconSize = size === 'xs' ? 11 : size === 'sm' ? 14 : 16
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full bg-[var(--member-avatar-4-bg)] text-[var(--member-avatar-4-fg)]', sizeClasses[size], className)}
      data-joint-avatar
      aria-hidden="true"
    >
      <UsersRound size={iconSize} strokeWidth={2.2} />
    </span>
  )
}
