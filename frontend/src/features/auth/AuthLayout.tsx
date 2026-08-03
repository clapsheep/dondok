import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '../../components/ThemeToggle'

type Props = { eyebrow?: string; title: string; description: string; children: ReactNode }

export function AuthLayout({ eyebrow, title, description, children }: Props) {
  return (
    <main className="auth-shell min-h-dvh bg-cream-100 p-3 text-ink-900 dark:bg-[#101714] dark:text-white xs:p-5 md:p-8">
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-6xl flex-col xs:min-h-[calc(100dvh-2.5rem)] md:min-h-[calc(100dvh-4rem)]">
        <header className="flex items-center justify-between px-1 py-2 md:px-3">
          <Link to="/" aria-label="돈독 홈"><img src="/dondok-logo-ko.svg" alt="돈독" className="h-10 w-auto dark:brightness-[1.8]" /></Link>
          <ThemeToggle />
        </header>

        <section className="auth-split-layout my-auto grid border-y border-[var(--line)]">
          <div className="hidden min-h-[38rem] flex-col justify-between bg-forest-700 p-10 text-white lg:flex">
            <div>
              <img src="/dondok-mark-reverse.svg" alt="" className="h-16 w-16" />
              <p className="mt-9 text-sm font-semibold tracking-[.14em] text-forest-100">함께 쓰는 가계부</p>
              <h2 className="mt-3 max-w-sm text-4xl leading-[1.25] font-semibold tracking-[-.035em]">우리의 오늘을 기록하고, 내일을 차곡차곡.</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-forest-100">누가 쓰고 넣었는지 자연스럽게 남기고, 자산과 소비의 흐름은 함께 확인해요.</p>
          </div>

          <div className="flex min-h-[34rem] items-center px-5 py-10 xs:px-8 md:px-14 lg:min-h-[38rem] lg:px-16">
            <div className="mx-auto w-full max-w-md">
              {eyebrow && <p className="mb-2 text-sm font-semibold text-brass-500">{eyebrow}</p>}
              <h1 className="text-3xl leading-tight font-semibold tracking-[-.035em] md:text-4xl">{title}</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)] md:text-base">{description}</p>
              <div className="mt-8">{children}</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
