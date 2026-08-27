const moneyKeypadHapticDurationMs = 10

type VibrationTarget = {
  vibrate?: (pattern: number | number[]) => boolean
}

export function requestMoneyKeypadHaptic(
  target: VibrationTarget | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (typeof target?.vibrate !== 'function') return false
  try {
    return target.vibrate(moneyKeypadHapticDurationMs)
  } catch {
    return false
  }
}
