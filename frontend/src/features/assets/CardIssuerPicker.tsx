import { Check, ChevronDown, CreditCard, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '../../components/ui/Popover'
import { cn } from '../../lib/cn'
import { cardIssuer, cardIssuers, type CardIssuerCode } from './cardIssuers'

export function CardIssuerAvatar({ code, size = 'md' }: { code: CardIssuerCode | null | undefined; size?: 'sm' | 'md' }) {
  const issuer = cardIssuer(code)
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full border border-black/5 bg-white font-bold shadow-sm dark:border-white/10', size === 'sm' ? 'size-6 text-[0.52rem]' : 'size-8 text-[0.62rem]')}
      style={{ color: issuer.color }}
      aria-hidden="true"
      data-card-issuer-avatar={issuer.code}
    >
      {issuer.logoUrl && !imageFailed
        ? <img className="size-full object-contain p-1" src={issuer.logoUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        : issuer.code === 'OTHER' ? <CreditCard size={size === 'sm' ? 13 : 16} /> : <span>{issuer.shortName}</span>}
    </span>
  )
}

export function CardIssuerPicker({ value, onChange, error, id = 'cardIssuer' }: {
  value: CardIssuerCode
  onChange: (value: CardIssuerCode) => void
  error?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const generatedId = useId()
  const selected = cardIssuer(value)
  const titleId = `${id}-${generatedId}-title`
  const choose = (code: CardIssuerCode) => { onChange(code); setOpen(false) }

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-semibold" htmlFor={id}>카드사</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id={id} type="button" variant="secondary" className="h-12 w-full justify-start border border-[var(--line)] bg-[var(--surface)] px-3 text-left" aria-invalid={Boolean(error)} />}>
          <CardIssuerAvatar code={value} />
          <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          <ChevronDown className="shrink-0 text-[var(--muted)]" size={17} />
        </PopoverTrigger>
        <PopoverContent aria-labelledby={titleId} className="h-[min(62dvh,26rem)] md:h-auto md:max-h-[26rem]">
          <PopoverHeader className="border-b border-[var(--line)] px-4 py-3">
            <div><PopoverTitle id={titleId}>카드사 선택</PopoverTitle><PopoverDescription className="mt-1">로고로 카드를 빠르게 찾을 수 있어요.</PopoverDescription></div>
            <PopoverClose render={<Button type="button" variant="ghost" size="icon" aria-label="카드사 선택 닫기" />}><X size={18} /></PopoverClose>
          </PopoverHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {cardIssuers.map((issuer) => (
                <button key={issuer.code} type="button" className={cn('flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-forest-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)] dark:hover:bg-forest-950', issuer.code === value && 'bg-forest-50 text-forest-800 dark:bg-forest-950 dark:text-forest-100')} onClick={() => choose(issuer.code)}>
                  <CardIssuerAvatar code={issuer.code} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{issuer.name}</span>
                  {issuer.code === value ? <Check className="shrink-0" size={15} /> : null}
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {error ? <p className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}
