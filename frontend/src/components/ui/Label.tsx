import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-[13px] font-medium leading-5 text-[var(--muted)] select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)}
      {...props}
    />
  )
}
