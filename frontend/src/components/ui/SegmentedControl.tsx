import type { ReactNode } from 'react'
import { Button } from './Button'

type Option<T extends string> = { value: T; label: ReactNode; accessibleLabel?: string }

export function SegmentedControl<T extends string>({ label, value, options, onChange, className = '' }: {
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return <div className={`ui-segmented ${className}`} role="group" aria-label={label}>
    {options.map(option => <Button key={option.value} type="button" variant="ghost" className="ui-segment" aria-label={option.accessibleLabel} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</Button>)}
  </div>
}
