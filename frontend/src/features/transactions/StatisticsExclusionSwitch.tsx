import { useId } from 'react'
import { Switch } from '../../components/ui/Switch'
import { cn } from '../../lib/cn'

export function StatisticsExclusionSwitch({
  type,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: {
  type: 'INCOME' | 'EXPENSE'
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const labelId = useId()
  const descriptionId = useId()
  const label = type === 'INCOME' ? '수입에 포함하지 않기' : '지출에 포함하지 않기'

  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-[var(--line)] py-4 sm:py-5', className)}>
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-semibold">{label}</p>
        <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--muted)]">
          자산 잔액은 바뀌지만 달력과 통계 합계에는 반영하지 않아요.
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      />
    </div>
  )
}
