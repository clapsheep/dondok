import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-sm font-semibold leading-snug text-ink-900 select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:text-white', className)}
      {...props}
    />
  )
}
