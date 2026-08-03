import type { Category } from './api'

export function insertCategoryBeforeFallback(categories: readonly Category[], added: Category) {
  const withoutDuplicate = categories.filter((category) => category.categoryId !== added.categoryId)
  const fallbackIndex = withoutDuplicate.findIndex((category) => category.isFallback)
  if (fallbackIndex < 0) return [...withoutDuplicate, added]
  return [
    ...withoutDuplicate.slice(0, fallbackIndex),
    added,
    ...withoutDuplicate.slice(fallbackIndex),
  ]
}
