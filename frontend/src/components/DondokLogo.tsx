import { cn } from '../lib/cn'

export function DondokLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} aria-hidden="true">
      <img src="/brand/dondok-wordmark.svg" width="1364" height="335" alt="" className="h-full w-auto dark:hidden" />
      <img src="/brand/dondok-wordmark-dark.svg" width="1364" height="335" alt="" className="hidden h-full w-auto dark:block" />
    </span>
  )
}
