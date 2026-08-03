import type { InputHTMLAttributes, ReactNode } from 'react'
import { Input } from './Input'
import { Label } from './Label'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: ReactNode
  error?: string
}

export function Field({ id, label, hint, error, ...props }: Props) {
  const describedBy = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
  return (
    <div data-slot="field" data-invalid={Boolean(error)} className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />
      {hint ? <p id={`${id}-hint`} data-slot="field-description" className="text-xs text-[var(--muted)]">{hint}</p> : null}
      {error ? <p id={`${id}-error`} data-slot="field-error" className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </div>
  )
}
