import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { cn } from '../../lib/cn'

export function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn('grid w-full gap-2', className)} {...props} />
}

export function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        'peer relative flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-[var(--ring)] focus-visible:ring-3 focus-visible:ring-[var(--ring)]/30 data-checked:border-forest-700 data-checked:bg-forest-700 data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:data-checked:border-forest-100 dark:data-checked:bg-forest-100',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-white dark:bg-forest-900" />
    </RadioPrimitive.Root>
  )
}
