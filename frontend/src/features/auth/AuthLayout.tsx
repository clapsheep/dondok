import { LegalLinks } from '../legal/LegalPages'
import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { DondokLogo } from '../../components/DondokLogo'
import { AuthStory } from './AuthStory'
import './auth-layout.css'

type Props = { eyebrow?: string; title: string; description: string; children: ReactNode }
export function AuthLayout({ eyebrow, title, description, children }: Props) {
  const location = useLocation()
  const [params] = useSearchParams()
  const next = params.get('next')
  const suffix = next ? `?next=${encodeURIComponent(next)}` : ''
  return <div className="auth-shell"><header className="auth-header"><Link to="/" aria-label="돈독 홈"><DondokLogo className="h-8" /></Link><nav aria-label="계정 메뉴">{location.pathname.endsWith('/login') ? <Link to={`/sign-up${suffix}`} aria-label="회원가입 화면으로">회원가입</Link> : <Link to={`/login${suffix}`} aria-label="로그인 화면으로">로그인</Link>}</nav></header><main className="auth-layout"><AuthStory /><section className="auth-form-column">{eyebrow ? <p className="auth-eyebrow">{eyebrow}</p> : null}<h1>{title}</h1><p className="auth-form-description">{description}</p>{children}</section></main><LegalLinks /></div>
}
