import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { saveTheme, storedTheme, subscribeTheme, type Theme } from '../lib/theme'
import { RadioGroup, RadioGroupItem } from './ui/RadioGroup'

const themeOptions: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '기기 설정', icon: Monitor },
  { value: 'light', label: '라이트', icon: Sun },
  { value: 'dark', label: '다크', icon: Moon },
]

export function ThemeSettings() {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, storedTheme, () => 'system')

  return (
    <section className="mt-8 max-w-4xl border-y border-[var(--line)] py-5 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] sm:items-center sm:gap-8" aria-labelledby="theme-settings-title">
      <div>
        <h2 id="theme-settings-title" className="text-lg font-semibold">화면 모드</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">기기 설정을 따르면 휴대폰이나 컴퓨터의 화면 모드에 맞춰 자동으로 바뀌어요.</p>
      </div>
      <RadioGroup
        name="theme"
        value={theme}
        onValueChange={(value) => saveTheme(value as Theme)}
        aria-labelledby="theme-settings-title"
        className="mt-4 grid grid-cols-3 gap-0 divide-x divide-[var(--line)] border-y border-[var(--line)] sm:mt-0"
      >
        {themeOptions.map(({ value, label, icon: Icon }) => {
          const selected = value === theme
          const optionId = `theme-${value}`
          return (
            <label
              key={value}
              htmlFor={optionId}
              className={`relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 px-2 py-2 text-center text-sm transition-colors focus-within:z-10 focus-within:ring-3 focus-within:ring-inset focus-within:ring-[var(--ring)] ${selected ? 'bg-forest-50 font-semibold text-forest-800 dark:bg-forest-950 dark:text-forest-100' : 'bg-[var(--surface)] text-[var(--muted)] hover:bg-forest-50 hover:text-forest-800 dark:hover:bg-forest-950 dark:hover:text-forest-100'}`}
            >
              <span className="flex items-center gap-1.5">
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </span>
              {selected ? <span className="flex items-center gap-1 text-xs"><Check size={13} aria-hidden="true" />선택됨</span> : <span className="h-4" aria-hidden="true" />}
              <RadioGroupItem id={optionId} value={value} className="sr-only" />
            </label>
          )
        })}
      </RadioGroup>
    </section>
  )
}
