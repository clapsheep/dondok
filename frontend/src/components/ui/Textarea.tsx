import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 resize-y rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-3 text-base text-ink-900 outline-none transition-colors placeholder:text-[#8b9691] focus-visible:border-[var(--ring)] focus-visible:ring-3 focus-visible:ring-[var(--ring)]/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-700 aria-invalid:ring-3 aria-invalid:ring-red-700/20 dark:text-white dark:aria-invalid:border-[#ff9d93]',
        className,
      )}
      {...props}
    />
  )
}
