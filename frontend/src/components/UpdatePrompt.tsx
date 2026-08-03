import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './ui/Button'

export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <aside className="fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xl md:bottom-3" aria-live="polite">
      <p className="text-sm font-medium">새 버전이 준비됐어요.</p>
      <div className="flex gap-1">
        <Button variant="ghost" onClick={() => setNeedRefresh(false)}>나중에</Button>
        <Button onClick={() => updateServiceWorker(true)}>안전하게 새로고침</Button>
      </div>
    </aside>
  )
}
