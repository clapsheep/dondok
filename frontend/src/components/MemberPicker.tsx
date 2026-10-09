import { MemberAvatar } from './MemberAvatar'
import { RadioGroup, RadioGroupItem } from './ui/RadioGroup'

type MemberOption = {
  memberId: string
  displayName: string
  withdrawn?: boolean
  currentUser: boolean
}

type Props = {
  id: string
  label: string
  members: MemberOption[]
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}

export function MemberPicker({ id, label, members, value, onChange, error, disabled = false }: Props) {
  const labelId = `${id}-label`
  const errorId = error ? `${id}-error` : undefined

  return (
    <fieldset data-slot="member-picker" data-invalid={Boolean(error)} className="min-w-0" disabled={disabled}>
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
        {members.filter((member) => !member.withdrawn || member.memberId === value).map((member) => {
          const optionId = `${id}-${member.memberId}`
          const selected = member.memberId === value
          return (
            <label
              key={member.memberId}
              htmlFor={optionId}
              className={`ui-focus-group flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl border border-transparent px-3 py-2 text-sm transition-colors   ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${selected ? 'bg-[var(--selection-surface)] text-[var(--selection)]' : 'bg-[var(--surface)] text-ink-900 hover:border-forest-600 hover:bg-[var(--surface-hover)] dark:text-white dark:hover:text-forest-100'}`}
            >
              <MemberAvatar displayName={member.displayName} memberId={member.memberId} size="md" className={selected ? 'ring-2 ring-[var(--selection)] ring-offset-1 ring-offset-[var(--surface)]' : undefined} />
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
