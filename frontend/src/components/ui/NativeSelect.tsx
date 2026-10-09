import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { controlSize, controlSurface } from './controlStyles'
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
        className={cn(controlSurface, controlSize, 'w-full min-w-0 appearance-none py-1.5 pr-8 data-[size=sm]:min-h-9 pointer-coarse:data-[size=sm]:min-h-11') }
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
    </div>
  )
}

export function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className="bg-[Canvas] text-[CanvasText]" {...props} />
}

export function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" className="bg-[Canvas] text-[CanvasText]" {...props} />
}
