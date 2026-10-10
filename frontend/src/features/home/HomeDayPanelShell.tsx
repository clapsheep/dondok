import { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

const mobileQuery = '(max-width: 767px)'
function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(mobileQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
function isMobile() { return window.matchMedia(mobileQuery).matches }

/** One persistent panel: inline on desktop, native modal top layer on mobile. */
export function HomeDayPanelShell({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [expanded, setExpanded] = useState(false)
  const dragStart = useRef<number | null>(null)
  const dragged = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const focused = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement) ? document.activeElement : null
    const wasModal = dialog.matches(':modal')
    const shouldBeModal = mobile && open
    if (dialog.open && (wasModal !== shouldBeModal || (mobile && !open))) dialog.close()
    if (!mobile && !dialog.open) dialog.setAttribute('open', '')
    if (shouldBeModal && !dialog.open) dialog.showModal()
    if (focused && dialog.open) focused.focus({ preventScroll: true })
    if (!shouldBeModal) return
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = previousOverflow }
  }, [mobile, open])

  function close() { setExpanded(false); onClose() }
  return <dialog ref={dialogRef} className="home-day-panel" role={mobile ? 'dialog' : 'complementary'} aria-modal={mobile && open ? true : undefined}
    aria-label="선택한 날짜의 기록" data-expanded={expanded} onCancel={event => { event.preventDefault(); close() }}
    onClick={event => {
      if (!mobile || event.target !== event.currentTarget) return
      const box = event.currentTarget.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
    }}>
    <button type="button" className="home-day-grab" aria-label={expanded ? '내역 창 줄이기' : '내역 창 펼치기'} aria-expanded={expanded}
      onClick={() => { if (!dragged.current) setExpanded(value => !value); dragged.current = false }}
      onPointerDown={event => { dragStart.current = event.clientY; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerCancel={() => { dragStart.current = null }}
      onPointerUp={event => {
        if (dragStart.current === null) return
        const delta = event.clientY - dragStart.current
        dragStart.current = null; dragged.current = Math.abs(delta) > 30
        if (delta < -30) setExpanded(true)
        if (delta > 60) { if (expanded) setExpanded(false); else close() }
      }}><span/></button>
    {children}
  </dialog>
}
