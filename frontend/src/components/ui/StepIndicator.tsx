export function StepIndicator({ step, total = 3, label = '입력 진행' }: { step: number; total?: number; label?: string }) {
  return (
    <span role="img" aria-label={`${label}: ${total}단계 중 ${step}단계`} className="inline-flex shrink-0 items-center gap-1.5">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} aria-hidden="true" className={`h-1.5 rounded-full ${index + 1 === step ? 'w-5 bg-[var(--selection)]' : index + 1 < step ? 'w-1.5 bg-[var(--selection)] opacity-45' : 'w-1.5 bg-[var(--line-subtle)]'}`} />
      ))}
    </span>
  )
}
