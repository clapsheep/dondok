export function compactCalendarWon(value: number) {
  const absolute = Math.abs(value)

  if (absolute < 10_000) return Math.round(absolute).toString()
  if (absolute < 100_000) return `${trimDecimal(absolute / 10_000)}만`
  if (absolute < 1_000_000) return `${trimDecimal(absolute / 10_000)}만`
  if (absolute < 10_000_000) return `${Math.round(absolute / 10_000)}만`
  if (absolute < 100_000_000) return `${trimDecimal(absolute / 10_000_000)}천만`
  if (absolute < 1_000_000_000) return `${trimDecimal(absolute / 100_000_000)}억`
  if (absolute < 100_000_000_000) return `${Math.round(absolute / 100_000_000)}억`
  if (absolute < 100_000_000_000_000) return `${trimDecimal(absolute / 1_000_000_000_000)}조`
  return `${Math.round(absolute / 1_000_000_000_000)}조`
}

export function nextCalendarDate(date: string) {
  return shiftCalendarDate(date, 1)
}

export function shiftCalendarDate(date: string, offset: number) {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + offset))
  return shifted.toISOString().slice(0, 10)
}

export function selectedDateForMonth(value: string | null, month: string, today: string) {
  if (value?.startsWith(`${month}-`) && isCalendarDate(value)) return value
  return today.startsWith(`${month}-`) ? today : `${month}-01`
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value
}

function trimDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, '')
}
