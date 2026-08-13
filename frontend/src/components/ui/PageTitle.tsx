import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function PageTitle({ className, ...props }: ComponentProps<'h1'>) {
  return (
    <h1
      data-slot="page-title"
      className={cn('text-2xl font-semibold tracking-[-.025em]', className)}
      {...props}
    />
  )
}
