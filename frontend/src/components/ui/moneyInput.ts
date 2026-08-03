export function normalizeWonInput(input: string, allowNegative = false): string | null {
  let compact = input.replaceAll(',', '').replaceAll(/\s/g, '').trim()
  if (compact.startsWith('₩')) compact = compact.slice(1)
  if (compact.endsWith('원')) compact = compact.slice(0, -1)
  if (compact === '') return ''

  const negative = compact.startsWith('-')
  if (negative && !allowNegative) return null
  const digits = negative ? compact.slice(1) : compact
  if (digits === '') return negative ? '-' : ''
  if (!/^\d+$/.test(digits)) return null

  const canonicalDigits = digits.replace(/^0+(?=\d)/, '')
  return `${negative ? '-' : ''}${canonicalDigits}`
}

export function formatWonInput(value: string): string {
  const compact = value.replaceAll(',', '').trim()
  if (compact === '' || compact === '-') return compact
  const negative = compact.startsWith('-')
  const digits = negative ? compact.slice(1) : compact
  if (!/^\d+$/.test(digits)) return value
  return `${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}
