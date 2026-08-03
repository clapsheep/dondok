import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

type NativeSelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
}

export function NativeSelect({ className, size = 'default', ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      data-size={size}
      className={cn('group/native-select relative w-full has-[select:disabled]:opacity-50', className)}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="min-h-11 w-full min-w-0 appearance-none rounded-md border border-[var(--line)] bg-[var(--surface)] py-2 pl-3 pr-10 text-base text-ink-900 outline-none transition-colors focus-visible:border-[var(--ring)] focus-visible:ring-3 focus-visible:ring-[var(--ring)]/30 disabled:cursor-not-allowed aria-invalid:border-red-700 aria-invalid:ring-3 aria-invalid:ring-red-700/20 data-[size=sm]:min-h-9 data-[size=sm]:py-1 data-[size=sm]:text-sm dark:text-white dark:aria-invalid:border-[#ff9d93]"
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
    </div>
  )
}

export function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className="bg-[Canvas] text-[CanvasText]" {...props} />
}

export function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" className="bg-[Canvas] text-[CanvasText]" {...props} />
}
