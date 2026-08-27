import { useId } from 'react'
import { MoneyField } from '../../components/ui/MoneyField'
import { Switch } from '../../components/ui/Switch'

export function RepresentativePaymentFields({
  checked,
  statisticsAmountWon,
  onCheckedChange,
  onStatisticsAmountChange,
  error,
  disabled = false,
}: {
  checked: boolean
  statisticsAmountWon: string
  onCheckedChange: (checked: boolean) => void
  onStatisticsAmountChange: (value: string) => void
  error?: string
  disabled?: boolean
}) {
  const labelId = useId()
  const descriptionId = useId()

  return (
    <section className="border-y border-[var(--line)] py-4 sm:py-5" aria-labelledby={labelId}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold">대표로 결제했어요</p>
          <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--muted)]">
            자산에서는 실제 결제액이 빠지고, 달력과 통계에는 내 부담액만 지출로 반영돼요.
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
      {checked ? (
        <MoneyField
          id="statisticsAmountWon"
          className="mt-4 max-w-sm"
          label="지출로 반영할 금액"
          value={statisticsAmountWon}
          onValueChange={onStatisticsAmountChange}
          placeholder="0"
          hint="0원부터 실제 결제 금액까지 입력할 수 있어요."
          error={error}
          disabled={disabled}
          required
        />
      ) : null}
    </section>
  )
}
