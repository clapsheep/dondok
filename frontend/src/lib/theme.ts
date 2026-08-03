export type Theme = 'system' | 'light' | 'dark'

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
}
