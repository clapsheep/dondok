import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronDown, LoaderCircle, Plus, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { ApiError } from '../../lib/api'
import { categoryApi, categoryKeys, type Category, type CategoryKind } from '../categories/api'
import { insertCategoryBeforeFallback } from '../categories/categoryList'

type Props = {
  kind: CategoryKind
  categories: Category[]
  value: string
  missingName?: string
  onChange: (categoryId: string) => void
  error?: string
  disabled?: boolean
  online: boolean
}

const triggerClassName = 'min-w-0 w-full justify-between gap-3 px-3 text-left text-base font-normal'

export function CategoryPicker({ kind, categories, value, missingName, onChange, error, disabled = false, online }: Props) {
  const queryClient = useQueryClient()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const kindLabel = kind === 'EXPENSE' ? '지출' : '수입'
  const selected = categories.find((category) => category.categoryId === value)
  const selectedName = selected?.name ?? (value ? `${missingName ?? '연결했던 분류'} (현재 목록에 없음)` : '분류를 선택해 주세요')

  const create = useMutation({
    mutationFn: (categoryName: string) => categoryApi.create({ kind, name: categoryName }),
    onSuccess: (category) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(kind), (current = []) => insertCategoryBeforeFallback(current, category))
      void queryClient.invalidateQueries({ queryKey: categoryKeys.list(kind) })
      onChange(category.categoryId)
      finishClose()
    },
  })

  function openPicker() {
    if (disabled) return
    setAdding(false)
    setName('')
    create.reset()
    setOpen(true)
  }

  function requestClose() {
    if (!create.isPending) finishClose()
  }

  function finishClose() {
    setOpen(false)
    setAdding(false)
    setName('')
    create.reset()
    trigger.current?.focus()
  }

  function selectCategory(categoryId: string) {
    onChange(categoryId)
    finishClose()
  }

  function showAdd() {
    setAdding(true)
    setName('')
    create.reset()
  }

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Portals move the dialog in the DOM, but React events still bubble through
    // the component tree. Keep this submit from reaching TransactionFormPage.
    event.stopPropagation()
    const trimmed = name.trim()
    if (online && trimmed && !create.isPending) create.mutate(trimmed)
  }

  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-sm font-semibold" id="transaction-category-label">분류</span>
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        className={triggerClassName}
        aria-label={`분류 선택, 현재 ${selectedName}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'transactionCategory-error' : undefined}
        disabled={disabled}
        onClick={openPicker}
      >
        <span className="min-w-0 truncate">{selectedName}</span>
        <ChevronDown className="shrink-0 text-[var(--muted)]" size={18} aria-hidden="true" />
      </Button>
      {error ? <p id="transactionCategory-error" className="text-sm text-red-700 dark:text-[#ff9d93]" role="alert">{error}</p> : null}

      <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen) setOpen(true); else requestClose() }}>
        <DialogContent
          className="left-0 top-auto bottom-0 max-h-[calc(100dvh-.5rem)] w-full translate-x-0 translate-y-0 rounded-t-lg rounded-b-none md:left-1/2 md:top-1/2 md:bottom-auto md:w-[min(34rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
          aria-labelledby="transaction-category-dialog-title"
          finalFocus={trigger}
        >
          <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
            <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
              <div className="flex min-w-0 items-start gap-1">
                {adding ? <Button className="-ml-2 shrink-0" type="button" size="icon" variant="ghost" aria-label="분류 목록으로" disabled={create.isPending} onClick={() => { setAdding(false); setName(''); create.reset() }}><ArrowLeft size={19} /></Button> : null}
                <div className="min-w-0"><DialogTitle id="transaction-category-dialog-title">{adding ? `${kindLabel} 분류 추가` : `${kindLabel} 분류 선택`}</DialogTitle><DialogDescription className="mt-1">{adding ? '추가하면 모든 구성원이 함께 사용할 수 있어요.' : '기록에 사용할 항목을 선택해 주세요.'}</DialogDescription></div>
              </div>
              <Button className="shrink-0" type="button" size="icon" variant="ghost" aria-label="분류 선택 닫기" disabled={create.isPending} onClick={requestClose}><X size={19} /></Button>
            </header>

            {adding ? (
              <form className="pt-5" onSubmit={submitAdd}>
                <Field id="inlineCategoryName" label="항목 이름" value={name} onChange={(event) => { setName(event.target.value); create.reset() }} maxLength={100} placeholder="예: 반려동물" autoFocus required error={create.error instanceof ApiError && create.error.status === 409 ? '이미 같은 이름의 분류가 있어요.' : undefined} />
                {!online ? <p className="mt-4 border-l-4 border-amber-500 px-3 py-1 text-sm text-amber-900 dark:text-[#ffe3a3]" role="status">오프라인 상태예요. 입력은 유지되며 연결되면 추가할 수 있어요.</p> : null}
                {create.error && !(create.error instanceof ApiError && create.error.status === 409) ? <p className="mt-4 border-l-4 border-red-600 px-3 py-1 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{create.error instanceof Error ? create.error.message : '분류를 추가하지 못했어요.'}</p> : null}
                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-4 sm:flex sm:justify-end">
                  <Button type="button" variant="secondary" disabled={create.isPending} onClick={() => { setAdding(false); setName(''); create.reset() }}>목록으로</Button>
                  <Button type="submit" disabled={!online || !name.trim() || create.isPending}>{create.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}추가</Button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(7rem,100%),1fr))] gap-2 pt-5" role="group" aria-label={`${kindLabel} 분류 항목`}>
                {categories.map((category) => {
                  const active = category.categoryId === value
                  return <Button key={category.categoryId} type="button" variant="secondary" className={`min-w-0 whitespace-normal px-2.5 py-2 text-sm leading-5 ${active ? 'border-forest-700 bg-forest-50 font-semibold text-forest-800 dark:bg-forest-950 dark:text-forest-100' : 'border-[var(--line)] bg-transparent font-medium hover:border-forest-600 hover:bg-forest-50 dark:hover:bg-forest-950'}`} aria-pressed={active} title={category.name} onClick={() => selectCategory(category.categoryId)}>{active ? <Check className="shrink-0" size={15} aria-hidden="true" /> : null}<span className="line-clamp-2 break-words">{category.name}</span></Button>
                })}
                <Button type="button" variant="secondary" className="min-w-0 border-dashed bg-transparent px-2.5 py-2 text-forest-700 hover:border-forest-600 hover:bg-forest-50 dark:text-forest-100 dark:hover:bg-forest-950" onClick={showAdd}><Plus size={16} aria-hidden="true" />항목 추가</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
