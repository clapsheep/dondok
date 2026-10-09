import { ChevronDown } from 'lucide-react'

export function CompactSelect({ label, value, onChange, options, className = '' }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
}) {
  return <div className={`group relative flex h-11 min-w-0 items-center ${className}`}>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 text-base">
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <span aria-hidden="true" className="pointer-events-none flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-[var(--surface-hover)] px-2.5 text-[13px] text-[var(--foreground)] group-hover:bg-[var(--surface-selected)] group-focus-within:ring-2 group-focus-within:ring-[var(--ring)]/40">
      <span className="truncate">{value ? options.find((option) => option.value === value)?.label ?? label : label === '거래 종류' ? '종류' : label}</span><ChevronDown size={12} className="shrink-0 text-[var(--muted)]" />
    </span>
  </div>
}
