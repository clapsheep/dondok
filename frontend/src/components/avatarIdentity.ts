const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('ko', { granularity: 'grapheme' })
  : null

export const MEMBER_AVATAR_TONE_COUNT = 6

export function memberInitial(displayName: string) {
  const normalized = displayName.trim()
  if (!normalized) return '?'
  if (!segmenter) return Array.from(normalized)[0] ?? '?'
  return segmenter.segment(normalized)[Symbol.iterator]().next().value?.segment ?? '?'
}

export function memberAvatarTone(seed: string) {
  let hash = 0
  for (const character of seed) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return hash % MEMBER_AVATAR_TONE_COUNT
}
