import { api, jsonBody } from '../../lib/api'

export type CategoryKind = 'INCOME' | 'EXPENSE'

export type Category = {
  categoryId: string
  kind: CategoryKind
  systemCode: string | null
  name: string
  isFallback: boolean
  transactionCount: number
  version: number
}

export type DeleteCategoryResult = {
  categoryId: string
  fallbackCategoryId: string
  fallbackCategoryName: string
  remappedTransactionCount: number
  firstOccurredOn: string | null
  lastOccurredOn: string | null
}

export const categoryKeys = {
  all: ['categories'] as const,
  list: (kind: CategoryKind) => ['categories', 'list', kind] as const,
}

export const categoryApi = {
  list: (kind: CategoryKind) => api<Category[]>(`/api/categories?kind=${kind}`),
  create: (input: { kind: CategoryKind; name: string }) => api<Category>('/api/categories', {
    method: 'POST',
    body: jsonBody(input),
  }),
  update: (categoryId: string, input: { name: string; expectedVersion: number }) => api<Category>(`/api/categories/${categoryId}`, {
    method: 'PUT',
    body: jsonBody(input),
  }),
  remove: (categoryId: string, expectedVersion: number) => api<DeleteCategoryResult>(`/api/categories/${categoryId}?expectedVersion=${expectedVersion}`, {
    method: 'DELETE',
  }),
}
