import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '../../lib/cn'

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent bg-[var(--line-subtle)] outline-none after:absolute after:-inset-x-2 after:-inset-y-2 focus-visible:border-[var(--ring)] focus-visible:ring-3 focus-visible:ring-[var(--ring)]/30 data-checked:bg-forest-700 data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-[var(--line)] dark:data-checked:bg-forest-500',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className="pointer-events-none block size-5 translate-x-0 rounded-full bg-white shadow-sm transition-transform group-data-checked/switch:translate-x-5" />
    </SwitchPrimitive.Root>
  )
}
