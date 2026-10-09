export function groupTransactionsByDate<T>(items: readonly T[], occurredOn: (item: T) => string): Array<{ date: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const date = occurredOn(item)
    const group = groups.get(date)
    if (group) group.push(item)
    else groups.set(date, [item])
  }
  return [...groups].map(([date, items]) => ({ date, items }))
}
