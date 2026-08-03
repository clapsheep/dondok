const wonFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' })

export function formatWon(value: number) {
  return `${wonFormat.format(value)}원`
}

export function formatDate(value: string) {
  return dateFormat.format(new Date(`${value}T00:00:00+09:00`))
}

export function todayInSeoul() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
