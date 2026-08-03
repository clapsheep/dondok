import { RadioGroup, RadioGroupItem } from '../../components/ui/RadioGroup'
import type { LedgerMember } from '../membership/api'

type Props = {
  id: string
  label: string
  members: LedgerMember[]
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}

export function PerformerPicker({ id, label, members, value, onChange, error, disabled = false }: Props) {
  const labelId = `${id}-label`
  const errorId = error ? `${id}-error` : undefined

  return (
    <fieldset data-slot="performer-picker" data-invalid={Boolean(error)} className="min-w-0" disabled={disabled}>
      <legend id={labelId} className="text-sm font-semibold">{label}</legend>
      <RadioGroup
        name={id}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="mt-2 grid max-w-[32rem] grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2"
      >
        {members.map((member) => {
          const optionId = `${id}-${member.memberId}`
          const selected = member.memberId === value
          return (
            <label
              key={member.memberId}
              htmlFor={optionId}
              className={`flex min-h-12 min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors focus-within:ring-3 focus-within:ring-[var(--ring)]/30 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${selected ? 'border-forest-700 bg-forest-50 text-forest-800 dark:border-forest-300 dark:bg-forest-950 dark:text-forest-100' : 'border-[var(--line)] bg-[var(--surface)] text-ink-900 hover:border-forest-600 hover:bg-forest-50 dark:text-white dark:hover:bg-forest-950 dark:hover:text-forest-100'}`}
            >
              <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${selected ? 'bg-forest-700 text-white dark:bg-forest-100 dark:text-forest-900' : 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-white'}`} aria-hidden="true">
                {memberInitial(member.displayName)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium" title={member.displayName}>{member.displayName}</span>
              {member.currentUser ? <span className="shrink-0 text-xs text-[var(--muted)]">나</span> : null}
              <RadioGroupItem id={optionId} value={member.memberId} aria-invalid={Boolean(error)} />
            </label>
          )
        })}
      </RadioGroup>
      {error ? <p id={errorId} data-slot="field-error" className="mt-1 text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}
    </fieldset>
  )
}

function memberInitial(displayName: string) {
  return Array.from(displayName.trim())[0] ?? '?'
}
