import { ArrowRight, Sprout, SquarePen, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DondokLogo } from '../../components/DondokLogo'
import { Button } from '../../components/ui/Button'
import { LegalLinks } from '../legal/LegalPages'
import { ExampleLedger } from './AuthStory'
import './auth-layout.css'

export function LandingPage() {
  return <div className="auth-shell"><header className="auth-header"><Link to="/" aria-label="돈독 홈"><DondokLogo className="h-8" /></Link><nav><Link to="/login">로그인<ArrowRight size={16} className="ml-2" /></Link></nav></header><main><section className="landing-hero"><div><span className="auth-eyebrow">함께 쓰는 가계부, 돈독</span><h1>따로 쓴 오늘도,<br />함께 보는 내일도.</h1><p>각자의 기록을 한곳에 모으고,<br />우리의 돈 이야기를 편하게 시작해요.</p><div className="landing-actions"><Button asChild size="large"><Link to="/sign-up">돈독 시작하기<ArrowRight size={18} /></Link></Button><Button asChild size="large" variant="ghost"><Link to="/login">이어서 기록하기</Link></Button></div></div><div className="landing-stage"><ExampleLedger /></div></section><section className="landing-features" aria-label="돈독으로 함께 하는 일"><article><SquarePen /><h2>기록은 간단하게</h2><p>수입과 지출, 자산 사이의 이동까지.<br />필요한 것만 차례로 적어요.</p></article><article><Wallet /><h2>자산은 한눈에</h2><p>각자의 계좌와 카드도 한곳에서.<br />다가오는 결제까지 살펴봐요.</p></article><article><Sprout /><h2>생활은 함께</h2><p>어디에 쓰고, 얼마나 모았는지.<br />우리의 한 달을 함께 돌아봐요.</p></article></section></main><LegalLinks /></div>
}
