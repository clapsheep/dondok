import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { isValidElement, type ButtonHTMLAttributes, type Ref } from 'react'
import { cn } from '../../lib/cn'

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-forest-700 text-white hover:bg-forest-800',
        secondary: 'border border-[var(--line)] bg-[var(--surface)] text-ink-900 hover:bg-forest-50 hover:text-ink-900 dark:text-white dark:hover:bg-forest-800 dark:hover:text-white',
        ghost: 'text-forest-700 hover:bg-forest-50 hover:text-forest-800 dark:text-forest-100 dark:hover:bg-forest-800 dark:hover:text-white',
        destructive: 'bg-[#9f3f31] text-white hover:bg-[#843429]',
      },
      size: { default: 'min-h-11', large: 'min-h-12 px-5 text-base', icon: 'size-11 p-0' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean; ref?: Ref<HTMLButtonElement> }

export function Button({ className, variant, size, asChild, ref, children, ...props }: Props) {
  const sharedProps = {
    ref,
    'data-slot': 'button',
    className: cn(buttonVariants({ variant, size }), className),
    ...props,
  }

  if (asChild && isValidElement(children)) return <ButtonPrimitive {...sharedProps} nativeButton={false} role="link" render={children} />
  return <ButtonPrimitive {...sharedProps}>{children}</ButtonPrimitive>
}
