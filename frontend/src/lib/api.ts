export type SessionUser = {
  userId: string
  loginId: string
  displayName: string
  email: string
}

type CsrfResponse = { headerName: string; token: string }
export type ApiFieldError = { field: string; code: string }
type Problem = { detail?: string; title?: string; errorCode?: string; errors?: Record<string, string>; fieldErrors?: ApiFieldError[] }
type ApiRequestOptions = { notifyLedgerNotFound?: boolean }
type LedgerNotFoundListener = () => void

let csrfPromise: Promise<CsrfResponse> | undefined
const ledgerNotFoundListeners = new Set<LedgerNotFoundListener>()

async function csrf() {
  csrfPromise ??= fetch('/api/auth/csrf', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error('보안 정보를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.')
    return response.json() as Promise<CsrfResponse>
  })
  return csrfPromise
}

export class ApiError extends Error {
  readonly status: number
  readonly errorCode?: string
  readonly errors?: Record<string, string>
  readonly fieldErrors: ApiFieldError[]

  constructor(message: string, status: number, errorCode?: string, errors?: Record<string, string>, fieldErrors: ApiFieldError[] = []) {
    super(message)
    this.status = status
    this.errorCode = errorCode
    this.errors = errors
    this.fieldErrors = fieldErrors
  }
}

export async function api<T>(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}): Promise<T> {
  return request<T>(path, init, false, options)
}

async function request<T>(path: string, init: RequestInit, csrfRetried: boolean, options: ApiRequestOptions): Promise<T> {
  const method = init.method?.toUpperCase() ?? 'GET'
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = await csrf()
    headers.set(token.headerName, token.token)
  }

  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (response.status === 403 && !csrfRetried && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    csrfPromise = undefined
    return request<T>(path, init, true, options)
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Problem
    if (response.status === 404 && problem.errorCode === 'LEDGER_NOT_FOUND' && options.notifyLedgerNotFound !== false) {
      for (const listener of ledgerNotFoundListeners) listener()
    }
    throw new ApiError(problem.detail ?? problem.title ?? '요청을 처리하지 못했어요.', response.status, problem.errorCode, problem.errors, problem.fieldErrors)
  }
  const body = await response.text()
  if (!body.trim()) return undefined as T
  return JSON.parse(body) as T
}

export function clearCsrfToken() {
  csrfPromise = undefined
}

export function subscribeLedgerNotFound(listener: LedgerNotFoundListener) {
  ledgerNotFoundListeners.add(listener)
  return () => { ledgerNotFoundListeners.delete(listener) }
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value)
}
