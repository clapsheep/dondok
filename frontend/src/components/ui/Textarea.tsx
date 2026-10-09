import type { ComponentProps } from 'react'
import { controlSurface } from './controlStyles'
import { cn } from '../../lib/cn'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlSurface, 'min-h-20 w-full min-w-0 resize-y px-3 py-2 text-sm leading-6 pointer-coarse:text-base',
        className,
      )}
      {...props}
    />
  )
}
