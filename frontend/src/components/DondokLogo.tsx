import { cn } from '../lib/cn'

export function DondokLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center', className)} aria-hidden="true">
      <img src="/dondok-logo-ko.svg" alt="" className="h-full w-auto dark:hidden" />
      <span className="hidden h-full items-center gap-2 dark:inline-flex">
        <img src="/dondok-mark-reverse.svg" alt="" className="h-full w-auto" />
        <span className="text-xl font-semibold tracking-[-.04em] text-white">돈독</span>
      </span>
    </span>
  )
}
