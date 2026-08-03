const COMPACT_MONEY_CHARACTER_LIMIT = 14

export function shouldStackMoneyRail(formattedAmounts: readonly string[]) {
  return formattedAmounts.some((amount) => Array.from(amount).length > COMPACT_MONEY_CHARACTER_LIMIT)
}
