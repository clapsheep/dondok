import { Input as InputPrimitive } from '@base-ui/react/input'
import type { ComponentProps, MouseEvent } from 'react'
import { controlSize, controlSurface } from './controlStyles'
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
        controlSurface, controlSize, 'min-w-0 w-full',
        className,
      )}
      type={type}
      onClick={handleClick}
      {...props}
    />
  )
}
