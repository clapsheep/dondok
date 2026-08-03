import { Filter, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { RadioGroup as RadioGroupPrimitive, RadioGroupItem } from '../../components/ui/RadioGroup'
import type { Category } from '../categories/api'
import type { LedgerMember } from '../membership/api'
import { activeStatisticsFilterCount, type StatisticsOwnerFilter, type StatisticsUrlState } from './filters'

type FilterDraft = {
  memberId: string
  owner: StatisticsOwnerFilter
  categoryId: string
}

type Props = {
  state: StatisticsUrlState
  members: LedgerMember[]
  categories: Category[]
  categoriesPending: boolean
  categoriesError: boolean
  onRetryCategories: () => void
  onApply: (state: StatisticsUrlState) => void
}

export function StatisticsFilters({ state, members, categories, categoriesPending, categoriesError, onRetryCategories, onApply }: Props) {
  const trigger = useRef<HTMLButtonElement>(null)
  const pendingApply = useRef<StatisticsUrlState | null>(null)
  const onApplyRef = useRef(onApply)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromState(state))
  const triggerSummary = filterTriggerSummary(state, members, categories)

  useEffect(() => {
    onApplyRef.current = onApply
  }, [onApply])

  function open() {
    setDraft(draftFromState(state))
    window.history.pushState({ ...window.history.state, statisticsFilterDialog: true }, '')
    setDialogOpen(true)
  }

  const finishClose = useCallback(() => {
    setDialogOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }, [])

  function close() {
    if (window.history.state?.statisticsFilterDialog) window.history.back()
    else finishClose()
  }

  useEffect(() => {
    if (!dialogOpen) return
    function handleHistoryChange() {
      finishClose()
      const next = pendingApply.current
      pendingApply.current = null
      if (next) onApplyRef.current(next)
    }
    window.addEventListener('popstate', handleHistoryChange)
    return () => window.removeEventListener('popstate', handleHistoryChange)
  }, [dialogOpen, finishClose])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const selectedCategory = categories.find((category) => category.categoryId === draft.categoryId)
    pendingApply.current = {
      ...state,
      memberId: draft.memberId || null,
      owner: draft.owner,
      categoryId: draft.categoryId || null,
      direction: selectedCategory ? selectedCategory.kind.toLowerCase() as StatisticsUrlState['direction'] : state.direction,
    }
    close()
  }

  return (
    <>
      <Button
        ref={trigger}
        id="statistics-filter-trigger"
        type="button"
        variant="secondary"
        onClick={open}
        aria-expanded={dialogOpen}
        aria-controls="statistics-filter-dialog"
        aria-label={`${triggerSummary}, 통계 필터 열기`}
      >
        <Filter size={17} aria-hidden="true" />
        <span className="max-w-48 truncate">{triggerSummary}</span>
      </Button>
      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => { if (!nextOpen) close() }}>
        <DialogContent
          id="statistics-filter-dialog"
          className="left-0 top-auto bottom-0 max-h-[calc(100dvh-1rem)] w-full translate-x-0 translate-y-0 rounded-t-lg rounded-b-none md:left-1/2 md:top-1/2 md:bottom-auto md:w-[min(56rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
          aria-labelledby="statistics-filter-title"
          finalFocus={trigger}
        >
        <form className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6" onSubmit={submit}>
          <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
            <div><DialogTitle id="statistics-filter-title">통계 필터</DialogTitle><DialogDescription className="mt-1">선택한 세 조건을 함께 적용해요.</DialogDescription></div>
            <Button type="button" size="icon" variant="ghost" aria-label="통계 필터 닫기" onClick={close}><X size={19} /></Button>
          </header>

          <div className="grid gap-6 py-5 md:grid-cols-2">
            <FilterRadioGroup legend="구성원" description="실제로 돈을 받거나 쓴 구성원을 선택해요. 기록을 입력한 사람과는 달라요." value={draft.memberId} onValueChange={(memberId) => setDraft((current) => ({ ...current, memberId }))}>
              <FilterRadioOption name="statistics-member" value="">전체</FilterRadioOption>
              {members.map((member) => <FilterRadioOption key={member.memberId} name="statistics-member" value={member.memberId}>{member.displayName}{member.currentUser ? ' (나)' : ''}</FilterRadioOption>)}
            </FilterRadioGroup>

            <FilterRadioGroup legend="자산 소유자" description="거래의 주 자산에 현재 표시된 소유 marker를 기준으로 해요." value={draft.owner} onValueChange={(owner) => setDraft((current) => ({ ...current, owner: owner as StatisticsUrlState['owner'] }))}>
              <FilterRadioOption name="statistics-owner" value="all">전체</FilterRadioOption>
              <FilterRadioOption name="statistics-owner" value="joint">공동 소유</FilterRadioOption>
              {members.map((member) => <FilterRadioOption key={member.memberId} name="statistics-owner" value={`member:${member.memberId}`}>{member.displayName}{member.currentUser ? ' (나)' : ''}</FilterRadioOption>)}
            </FilterRadioGroup>

            <div className="md:col-span-2">
              <FilterRadioGroup legend="분류" description="수입과 지출 방향을 함께 확인하고 하나만 선택해요." value={draft.categoryId} onValueChange={(categoryId) => setDraft((current) => ({ ...current, categoryId }))} columns>
                <FilterRadioOption name="statistics-category" value="">전체</FilterRadioOption>
                {categories.map((category) => <FilterRadioOption key={category.categoryId} name="statistics-category" value={category.categoryId}>{category.name} · {category.kind === 'EXPENSE' ? '지출' : '수입'}</FilterRadioOption>)}
              </FilterRadioGroup>
              {categoriesPending ? <p className="mt-2 text-sm text-[var(--muted)]" role="status">분류를 불러오는 중…</p> : null}
              {categoriesError ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm" role="alert"><span>분류를 불러오지 못해 지금은 분류 필터를 바꿀 수 없어요.</span><Button type="button" variant="ghost" onClick={onRetryCategories}><RotateCcw size={16} />다시 불러오기</Button></div> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-4 sm:flex sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setDraft({ memberId: '', owner: 'all', categoryId: '' })}><RotateCcw size={17} />필터 초기화</Button>
            <Button type="submit">필터 적용</Button>
          </div>
        </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FilterRadioGroup({ legend, description, value, onValueChange, columns = false, children }: { legend: string; description: string; value: string; onValueChange: (value: string) => void; columns?: boolean; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-base font-semibold">{legend}</legend>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p>
      <RadioGroupPrimitive value={value} onValueChange={onValueChange} className={`mt-2 gap-0 border-y border-[var(--line)] ${columns ? 'grid sm:grid-cols-2 sm:gap-x-5' : ''}`}>{children}</RadioGroupPrimitive>
    </fieldset>
  )
}

function FilterRadioOption({ name, value, children }: { name: string; value: string; children: ReactNode }) {
  const id = `${name}-${value || 'all'}`
  return (
    <label htmlFor={id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 border-b border-[var(--line-subtle)] py-2 text-sm last:border-b-0">
      <RadioGroupItem id={id} value={value} />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  )
}

function draftFromState(state: StatisticsUrlState): FilterDraft {
  return { memberId: state.memberId ?? '', owner: state.owner, categoryId: state.categoryId ?? '' }
}

function filterTriggerSummary(state: StatisticsUrlState, members: LedgerMember[], categories: Category[]) {
  const count = activeStatisticsFilterCount(state)
  if (!count) return '공동 전체'
  const labels: string[] = []
  if (state.memberId) labels.push(members.find((member) => member.memberId === state.memberId)?.displayName ?? '선택한 구성원')
  if (state.owner === 'joint') labels.push('공동 소유')
  else if (state.owner.startsWith('member:')) labels.push(`${members.find((member) => member.memberId === state.owner.slice(7))?.displayName ?? '선택한 구성원'} 소유`)
  if (state.categoryId) labels.push(categories.find((category) => category.categoryId === state.categoryId)?.name ?? '선택한 분류')
  return `${labels.join(' · ')} · 필터 ${count}개`
}
