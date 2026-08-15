import { Check, ChevronDown, Landmark, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '../../components/ui/Popover'
import { cn } from '../../lib/cn'
import { financialInstitution, financialInstitutions, type FinancialInstitution, type FinancialInstitutionCode } from './financialInstitutions'

export function FinancialInstitutionAvatar({ code, size = 'md' }: { code: FinancialInstitutionCode | null | undefined; size?: 'sm' | 'md' }) {
  const institution = financialInstitution(code)
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full border border-black/5 bg-white font-bold shadow-sm dark:border-white/10', size === 'sm' ? 'size-6 text-[0.58rem]' : 'size-8 text-[0.68rem]')}
      style={{ color: institution.color }}
      aria-hidden="true"
      data-financial-institution-avatar={institution.code}
    >
      {institution.logoUrl && !imageFailed
        ? <img className="size-full object-contain p-1" src={institution.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        : institution.code === 'OTHER' ? <Landmark size={size === 'sm' ? 13 : 16} /> : <span>{institution.shortName}</span>}
    </span>
  )
}

export function FinancialInstitutionPicker({ value, onChange, error, id = 'financialInstitution', compact = false }: {
  value: FinancialInstitutionCode
  onChange: (value: FinancialInstitutionCode) => void
  error?: string
  id?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const generatedId = useId()
  const selected = financialInstitution(value)
  const titleId = `${id}-${generatedId}-title`
  const popular = financialInstitutions.filter((item) => item.popular)
  const others = financialInstitutions.filter((item) => !item.popular)
  const choose = (code: FinancialInstitutionCode) => { onChange(code); setOpen(false) }
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-semibold" htmlFor={id}>은행</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id={id} type="button" variant="secondary" className={cn(compact ? 'h-10' : 'h-12', 'w-full justify-start border border-[var(--line)] bg-[var(--surface)] px-3 text-left')} aria-invalid={Boolean(error)} />}>
          <FinancialInstitutionAvatar code={value} size={compact ? 'sm' : 'md'} />
          <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          <ChevronDown className="shrink-0 text-[var(--muted)]" size={17} />
        </PopoverTrigger>
        <PopoverContent aria-labelledby={titleId} className="h-[min(70dvh,34rem)] md:h-auto md:max-h-[34rem]">
          <PopoverHeader className="border-b border-[var(--line)] px-4 py-3">
            <div><PopoverTitle id={titleId}>은행 선택</PopoverTitle><PopoverDescription className="mt-1">계좌와 적금을 찾기 쉽게 표시해요.</PopoverDescription></div>
            <PopoverClose render={<Button type="button" variant="ghost" size="icon" aria-label="은행 선택 닫기" />}><X size={18} /></PopoverClose>
          </PopoverHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <InstitutionSection title="주요 은행" items={popular} selected={value} onChoose={choose} />
            <InstitutionSection title="그 외 금융기관" items={others} selected={value} onChoose={choose} className="mt-4" />
          </div>
        </PopoverContent>
      </Popover>
      {error ? <p className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}

function InstitutionSection({ title, items, selected, onChoose, className }: { title: string; items: readonly FinancialInstitution[]; selected: FinancialInstitutionCode; onChoose: (code: FinancialInstitutionCode) => void; className?: string }) {
  return <section className={className}><h3 className="px-1 pb-2 text-xs font-semibold text-[var(--muted)]">{title}</h3><div className="grid grid-cols-2 gap-1 sm:grid-cols-3">{items.map((item) => <button key={item.code} type="button" className={cn('flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-forest-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)] dark:hover:bg-forest-950', item.code === selected && 'bg-forest-50 text-forest-800 dark:bg-forest-950 dark:text-forest-100')} onClick={() => onChoose(item.code)}><FinancialInstitutionAvatar code={item.code} size="sm" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.code === selected ? <Check className="shrink-0" size={15} /> : null}</button>)}</div></section>
}
