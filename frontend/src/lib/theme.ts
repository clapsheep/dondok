export type Theme = 'system' | 'light' | 'dark'

const listeners = new Set<() => void>()
let environmentListenersReady = false

export function storedTheme(): Theme {
  const value = localStorage.getItem('dondok-theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function saveTheme(theme: Theme) {
  if (theme === 'system') localStorage.removeItem('dondok-theme')
  else localStorage.setItem('dondok-theme', theme)
  applyTheme(theme)
  listeners.forEach((listener) => listener())
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener)
  ensureEnvironmentListeners()
  return () => listeners.delete(listener)
}

function ensureEnvironmentListeners() {
  if (environmentListenersReady) return
  environmentListenersReady = true
  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', syncThemeEnvironment)
  window.addEventListener('storage', syncThemeEnvironment)
}

function syncThemeEnvironment() {
  applyTheme(storedTheme())
  listeners.forEach((listener) => listener())
}
