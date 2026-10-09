import { Coffee, Sprout } from 'lucide-react'

export function ExampleLedger() {
  return <div className="auth-mini" aria-label="예시 가계부"><p>우리의 가계부 · 예시</p><strong>18,550,000원</strong><div><Coffee size={20} /><span>함께 마신 커피<small>식비 · 지우</small></span><b>−9,000원</b></div><div><Sprout size={20} /><span>차곡차곡 적금<small>적금 납입 · 민서</small></span><b>500,000원</b></div></div>
}
export function AuthStory() {
  return <aside className="auth-story"><span className="auth-eyebrow">함께 쓰는 가계부, 돈독</span><h2>돈 이야기가<br />조금 더 편해지도록.</h2><p>각자의 기록을 한곳에 모으고,<br />우리의 생활을 함께 살펴봐요.</p><ExampleLedger /></aside>
}
