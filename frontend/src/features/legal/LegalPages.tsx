import { Link } from 'react-router-dom'
import { useLegalDocuments } from './api'
import { Button } from '../../components/ui/Button'
import { DondokLogo } from '../../components/DondokLogo'

export function LegalText({ text }: { text: string }) {
  return <div className="space-y-5 text-sm leading-7 whitespace-pre-wrap">{text.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
}

export function LegalLinks() {
  return <nav aria-label="약관 및 개인정보" className="flex flex-wrap justify-center gap-x-5 gap-y-2 py-5 text-sm text-[var(--muted)]">
    <Link className="inline-flex min-h-11 items-center underline underline-offset-4" to="/legal/terms" target="_blank" rel="noopener">이용약관</Link>
    <Link className="inline-flex min-h-11 items-center underline underline-offset-4" to="/legal/privacy" target="_blank" rel="noopener">개인정보 처리방침</Link>
  </nav>
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const documents = useLegalDocuments()
  return <main className="mx-auto max-w-3xl px-5 py-8 text-[var(--foreground)]">
    <Link to="/" aria-label="돈독 홈"><DondokLogo className="h-10" /></Link>
    <h1 className="mt-8 mb-5 text-2xl font-semibold">{kind === 'terms' ? '이용약관' : '개인정보 처리방침'}</h1>
    {documents.isPending ? <p role="status">문서를 불러오고 있어요.</p> : documents.isError ? <div role="alert"><p>문서를 불러오지 못했어요.</p><Button onClick={() => void documents.refetch()}>다시 불러오기</Button></div> : <LegalText text={documents.data[kind]} />}
    <LegalLinks />
  </main>
}
