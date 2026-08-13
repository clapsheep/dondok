import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

export function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

export function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

type ContentProps = PopoverPrimitive.Popup.Props & {
  backdropClassName?: string
  positionerClassName?: string
  positionerProps?: Omit<PopoverPrimitive.Positioner.Props, 'className' | 'children'>
}

export function PopoverContent({
  backdropClassName,
  positionerClassName,
  positionerProps,
  className,
  children,
  ...props
}: ContentProps) {
  return (
    <PopoverPrimitive.Portal data-slot="popover-portal">
      <PopoverPrimitive.Backdrop
        data-slot="popover-overlay"
        className={cn(
          'fixed inset-0 z-50 bg-black/45 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 md:bg-transparent',
          backdropClassName,
        )}
      />
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        className={cn('z-[51] outline-none', positionerClassName)}
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        {...positionerProps}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'flex max-h-[min(78dvh,44rem)] w-screen flex-col overflow-hidden rounded-t-lg border border-[var(--line)] bg-cream-100 text-ink-900 shadow-lg outline-none duration-150 data-open:animate-in data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:slide-out-to-bottom-4 dark:bg-[#101714] dark:text-white md:w-[min(40rem,calc(100vw-3rem))] md:rounded-lg md:data-open:fade-in-0 md:data-open:zoom-in-95 md:data-closed:fade-out-0 md:data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn('text-lg font-semibold leading-tight', className)} {...props} />
}

export function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={cn('text-sm leading-5 text-[var(--muted)]', className)} {...props} />
}

export function PopoverHeader({ className, ...props }: ComponentProps<'header'>) {
  return <header data-slot="popover-header" className={cn('flex items-start justify-between gap-3', className)} {...props} />
}
