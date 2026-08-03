import { Input as InputPrimitive } from '@base-ui/react/input'
import type { ComponentProps, MouseEvent } from 'react'
import { cn } from '../../lib/cn'

export function Input({ className, type, onClick, ...props }: ComponentProps<'input'>) {
  function handleClick(event: MouseEvent<HTMLInputElement>) {
    onClick?.(event)
    if (event.defaultPrevented || type !== 'date') return

    try {
      event.currentTarget.showPicker?.()
    } catch {
      // Browsers may reject showPicker() even when exposed; retain native input behavior.
    }
  }

  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'min-h-11 min-w-0 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-base text-ink-900 outline-none transition-colors placeholder:text-[#8b9691] focus-visible:border-[var(--ring)] focus-visible:ring-3 focus-visible:ring-[var(--ring)]/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-700 aria-invalid:ring-3 aria-invalid:ring-red-700/20 dark:text-white dark:aria-invalid:border-[#ff9d93]',
        className,
      )}
      type={type}
      onClick={handleClick}
      {...props}
    />
  )
}
