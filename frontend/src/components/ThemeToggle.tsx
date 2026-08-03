import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyTheme, saveTheme, storedTheme, type Theme } from '../lib/theme'
import { Button } from './ui/Button'

const nextTheme: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const themeLabel: Record<Theme, string> = {
  system: '시스템 테마 사용 중. 밝은 테마로 변경',
  light: '밝은 테마 사용 중. 어두운 테마로 변경',
  dark: '어두운 테마 사용 중. 시스템 테마로 변경',
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme)

  useEffect(() => {
    saveTheme(theme)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const syncSystem = () => { if (theme === 'system') applyTheme('system') }
    media.addEventListener('change', syncSystem)
    return () => media.removeEventListener('change', syncSystem)
  }, [theme])

  return (
    <Button variant="ghost" size="icon" aria-label={themeLabel[theme]} onClick={() => setTheme(nextTheme[theme])}>
      {theme === 'system' ? <Monitor size={19} /> : theme === 'dark' ? <Moon size={19} /> : <Sun size={19} />}
    </Button>
  )
}
