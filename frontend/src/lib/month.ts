const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonth(value: string | null): value is string {
  return Boolean(value && MONTH_PATTERN.test(value))
}

export function currentMonthInSeoul(now = new Date()) {
  return todayInSeoul(now).slice(0, 7)
}

export function todayInSeoul(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function monthTitle(month: string) {
  const [year, value] = month.split('-')
  return `${year}년 ${Number(value)}월`
}

export function addMonths(month: string, offset: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, value - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthBounds(month: string) {
  return { from: `${month}-01`, toExclusive: `${addMonths(month, 1)}-01` }
}
