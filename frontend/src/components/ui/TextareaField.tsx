import type { ComponentProps, ReactNode } from 'react'
import { Label } from './Label'
import { Textarea } from './Textarea'

type Props = Omit<ComponentProps<typeof Textarea>, 'id' | 'value' | 'onChange'> & {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: ReactNode
}

export function TextareaField({ id, label, value, onChange, error, hint, className, ...props }: Props) {
  const describedBy = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
  return (
    <div data-slot="field" data-invalid={Boolean(error)} className={className ?? 'grid min-w-0 gap-1'}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />
      {hint ? <p id={`${id}-hint`} data-slot="field-description" className="text-xs text-[var(--muted)]">{hint}</p> : null}
      {error ? <p id={`${id}-error`} data-slot="field-error" className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}
