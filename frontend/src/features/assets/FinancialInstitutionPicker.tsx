import { Check, ChevronDown, Landmark, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '../../components/ui/Popover'
import { cn } from '../../lib/cn'
import { financialInstitution, financialInstitutionsFor, type FinancialInstitution, type FinancialInstitutionCode, type FinancialInstitutionUsage } from './financialInstitutions'

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

const pickerCopy: Record<FinancialInstitutionUsage, { label: string; title: string; description: string; primary: string; secondary: string; other: string }> = {
  DEPOSIT: { label: '은행', title: '은행 선택', description: '계좌와 적금을 찾기 쉽게 표시해요.', primary: '주요 은행', secondary: '그 외 금융기관', other: '기타 금융기관' },
  LOAN: { label: '대출 기관', title: '대출 기관 선택', description: '대출을 받은 은행이나 캐피탈사를 선택해요.', primary: '주요 대출 기관', secondary: '그 외 은행·캐피탈', other: '기타 대출 기관' },
  INVESTMENT: { label: '증권사', title: '증권사 선택', description: '투자 자산을 관리하는 증권사를 선택해요.', primary: '주요 증권사', secondary: '그 외 증권사', other: '기타 증권사' },
}

export function FinancialInstitutionPicker({ value, onChange, error, id = 'financialInstitution', compact = false, usage = 'DEPOSIT' }: {
  value: FinancialInstitutionCode
  onChange: (value: FinancialInstitutionCode) => void
  error?: string
  id?: string
  compact?: boolean
  usage?: FinancialInstitutionUsage
}) {
  const [open, setOpen] = useState(false)
  const generatedId = useId()
  const selected = financialInstitution(value)
  const titleId = `${id}-${generatedId}-title`
  const copy = pickerCopy[usage]
  const available = financialInstitutionsFor(usage)
  const popular = available.filter((item) => item.popular)
  const others = available.filter((item) => !item.popular)
  const choose = (code: FinancialInstitutionCode) => { onChange(code); setOpen(false) }
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-semibold" htmlFor={id}>{copy.label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id={id} type="button" variant="secondary" className={cn(compact ? 'h-10' : 'h-12', 'w-full justify-start border border-[var(--line)] bg-[var(--surface)] px-3 text-left')} aria-invalid={Boolean(error)} />}>
          <FinancialInstitutionAvatar code={value} size={compact ? 'sm' : 'md'} />
          <span className="min-w-0 flex-1 truncate">{selected.code === 'OTHER' ? copy.other : selected.name}</span>
          <ChevronDown className="shrink-0 text-[var(--muted)]" size={17} />
        </PopoverTrigger>
        <PopoverContent aria-labelledby={titleId} className="h-[min(70dvh,34rem)] md:h-auto md:max-h-[34rem]">
          <PopoverHeader className="border-b border-[var(--line)] px-4 py-3">
            <div><PopoverTitle id={titleId}>{copy.title}</PopoverTitle><PopoverDescription className="mt-1">{copy.description}</PopoverDescription></div>
            <PopoverClose render={<Button type="button" variant="ghost" size="icon" aria-label={`${copy.title} 닫기`} />}><X size={18} /></PopoverClose>
          </PopoverHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <InstitutionSection title={copy.primary} items={popular} selected={value} onChoose={choose} otherName={copy.other} />
            <InstitutionSection title={copy.secondary} items={others} selected={value} onChoose={choose} otherName={copy.other} className="mt-4" />
          </div>
        </PopoverContent>
      </Popover>
      {error ? <p className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}

function InstitutionSection({ title, items, selected, onChoose, otherName, className }: { title: string; items: readonly FinancialInstitution[]; selected: FinancialInstitutionCode; onChoose: (code: FinancialInstitutionCode) => void; otherName: string; className?: string }) {
  return <section className={className}><h3 className="px-1 pb-2 text-xs font-semibold text-[var(--muted)]">{title}</h3><div className="grid grid-cols-2 gap-1 sm:grid-cols-3">{items.map((item) => <button key={item.code} type="button" className={cn('flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-forest-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)] dark:hover:bg-forest-950', item.code === selected && 'bg-forest-50 text-forest-800 dark:bg-forest-950 dark:text-forest-100')} onClick={() => onChoose(item.code)}><FinancialInstitutionAvatar code={item.code} size="sm" /><span className="min-w-0 flex-1 truncate">{item.code === 'OTHER' ? otherName : item.name}</span>{item.code === selected ? <Check className="shrink-0" size={15} /> : null}</button>)}</div></section>
}
