import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Copy, LoaderCircle, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError } from '../../lib/api'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { transactionKeys } from '../transactions/api'
import { categoryApi, categoryKeys, type Category, type CategoryKind, type DeleteCategoryResult } from './api'
import { insertCategoryBeforeFallback } from './categoryList'
import { SortableCategoryGrid } from './SortableCategoryGrid'

type EditDraft = { categoryId: string; name: string; expectedVersion: number }
type Conflict = { action: 'rename' | 'delete'; latest: Category; draftName: string }
type MissingDraft = { name: string }

export function CategorySettingsPage() {
  const queryClient = useQueryClient()
  const online = useOnlineStatus()
  const [params, setParams] = useSearchParams()
  const kind: CategoryKind = params.get('kind') === 'INCOME' ? 'INCOME' : 'EXPENSE'
  const [addName, setAddName] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>()
  const [edit, setEdit] = useState<EditDraft>()
  const [pendingDelete, setPendingDelete] = useState<Category>()
  const [conflict, setConflict] = useState<Conflict>()
  const [missingDraft, setMissingDraft] = useState<MissingDraft>()
  const [deletedElsewhere, setDeletedElsewhere] = useState('')
  const [result, setResult] = useState<DeleteCategoryResult>()
  const [copied, setCopied] = useState(false)
  const [orderNotice, setOrderNotice] = useState<{ kind: CategoryKind; result: 'saved' | 'conflict' }>()
  const categories = useQuery({
    queryKey: categoryKeys.list(kind),
    queryFn: () => categoryApi.list(kind),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })

  const create = useMutation({
    mutationFn: (name: string) => categoryApi.create({ kind, name }),
    onSuccess: (category) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(kind), (current = []) => insertCategoryBeforeFallback(current, category))
      queryClient.invalidateQueries({ queryKey: categoryKeys.list(kind) })
      setAddName('')
      setSelectedCategoryId(category.categoryId)
      setMissingDraft(undefined)
    },
  })
  const rename = useMutation({
    mutationFn: (draft: EditDraft) => categoryApi.update(draft.categoryId, { name: draft.name.trim(), expectedVersion: draft.expectedVersion }),
    onSuccess: (category) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(kind), (current = []) => current.map((item) => item.categoryId === category.categoryId ? category : item))
      queryClient.invalidateQueries({ queryKey: categoryKeys.list(kind) })
      queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      setEdit(undefined)
      setConflict(undefined)
      setMissingDraft(undefined)
    },
    onError: (error, draft) => void handleMutationError(error, 'rename', draft.name),
  })
  const remove = useMutation({
    mutationFn: (category: Category) => categoryApi.remove(category.categoryId, category.version),
    onSuccess: (deleted) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(kind), (current = []) => current.filter((item) => item.categoryId !== deleted.categoryId))
      queryClient.invalidateQueries({ queryKey: categoryKeys.list(kind) })
      queryClient.invalidateQueries({ queryKey: transactionKeys.all })
      setSelectedCategoryId(undefined)
      setPendingDelete(undefined)
      setConflict(undefined)
      setResult(deleted)
      setDeletedElsewhere('')
    },
    onError: (error) => void handleMutationError(error, 'delete', ''),
  })
  const reorder = useMutation({
    mutationFn: ({ kind: requestedKind, categories: next }: { kind: CategoryKind; categories: Category[] }) => categoryApi.reorder({
      kind: requestedKind,
      categories: next.map((category) => ({
        categoryId: category.categoryId,
        expectedVersion: category.version,
      })),
    }),
    onMutate: async ({ kind: requestedKind, categories: next }) => {
      setOrderNotice(undefined)
      await queryClient.cancelQueries({ queryKey: categoryKeys.list(requestedKind) })
      const previous = queryClient.getQueryData<Category[]>(categoryKeys.list(requestedKind))
      queryClient.setQueryData<Category[]>(categoryKeys.list(requestedKind), next)
      return { previous }
    },
    onSuccess: (ordered, { kind: requestedKind }) => {
      queryClient.setQueryData<Category[]>(categoryKeys.list(requestedKind), ordered)
      setOrderNotice({ kind: requestedKind, result: 'saved' })
    },
    onError: async (error, { kind: requestedKind }, context) => {
      if (context?.previous) queryClient.setQueryData<Category[]>(categoryKeys.list(requestedKind), context.previous)
      if (!(error instanceof ApiError) || error.status !== 412) return
      await queryClient.fetchQuery({
        queryKey: categoryKeys.list(requestedKind),
        queryFn: () => categoryApi.list(requestedKind),
        staleTime: 0,
      })
      setOrderNotice({ kind: requestedKind, result: 'conflict' })
    },
  })

  async function handleMutationError(error: unknown, action: Conflict['action'], draftName: string) {
    if (!(error instanceof ApiError)) return
    if (error.status === 404) {
      if (draftName) setMissingDraft({ name: draftName })
      else setDeletedElsewhere(pendingDelete?.name ?? '선택한 분류')
      setSelectedCategoryId(undefined)
      setConflict(undefined)
      setPendingDelete(undefined)
      await queryClient.invalidateQueries({ queryKey: categoryKeys.list(kind) })
      return
    }
    if (error.status !== 412) return
    const latest = await queryClient.fetchQuery({ queryKey: categoryKeys.list(kind), queryFn: () => categoryApi.list(kind), staleTime: 0 })
    const categoryId = action === 'rename' ? edit?.categoryId : pendingDelete?.categoryId
    const latestCategory = latest.find((category) => category.categoryId === categoryId)
    if (latestCategory) setConflict({ action, latest: latestCategory, draftName })
    else if (draftName) setMissingDraft({ name: draftName })
  }

  function changeKind(next: CategoryKind) {
    setParams({ kind: next }, { replace: true })
    setSelectedCategoryId(undefined)
    setEdit(undefined)
    setPendingDelete(undefined)
    setConflict(undefined)
    setMissingDraft(undefined)
    setResult(undefined)
    setDeletedElsewhere('')
    setOrderNotice(undefined)
    create.reset()
    rename.reset()
    remove.reset()
    reorder.reset()
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = addName.trim()
    if (online && name) create.mutate(name)
  }

  function saveRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (online && edit?.name.trim()) rename.mutate(edit)
  }

  function rebaseConflict() {
    if (!conflict) return
    if (conflict.action === 'rename') {
      setEdit({ categoryId: conflict.latest.categoryId, name: conflict.draftName, expectedVersion: conflict.latest.version })
    } else {
      setPendingDelete(conflict.latest)
    }
    setConflict(undefined)
    rename.reset()
    remove.reset()
  }

  async function copyMissingName() {
    if (!missingDraft) return
    try {
      await navigator.clipboard.writeText(missingDraft.name)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const fallback = categories.data?.find((category) => category.isFallback)
  const selectedCategory = categories.data?.find((category) => category.categoryId === selectedCategoryId)

  function selectCategory(category: Category) {
    setSelectedCategoryId(category.categoryId)
    setEdit(undefined)
    setPendingDelete(undefined)
    setConflict(undefined)
    rename.reset()
    remove.reset()
  }

  return (
    <AppShell ledgerNavigation>
      <section className="mx-auto max-w-5xl py-7 md:py-10">
        <Button asChild variant="ghost"><Link to="/settings"><ArrowLeft size={17} />설정으로 돌아가기</Link></Button>
        <header className="mt-5 border-b border-[var(--line)] pb-5">
          <p className="text-sm font-semibold text-brass-500">공동 기준</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em]">분류 설정</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">모든 구성원이 같은 분류를 사용해요. 연결된 분류를 삭제하면 같은 종류의 ‘기타’로 거래가 이동합니다.</p>
        </header>

        <div className="mt-5 grid grid-cols-2 border border-[var(--line)]" role="group" aria-label="분류 종류">
          <KindButton active={kind === 'EXPENSE'} onClick={() => changeKind('EXPENSE')}>지출 분류</KindButton>
          <KindButton active={kind === 'INCOME'} onClick={() => changeKind('INCOME')}>수입 분류</KindButton>
        </div>

        {!online ? <Notice tone="warning">오프라인 상태예요. 입력은 유지되며 연결된 뒤 추가·수정·삭제할 수 있어요.</Notice> : null}
        {result ? <Notice tone="success">‘{result.fallbackCategoryName}’ 분류로 {result.remappedTransactionCount}건을 옮기고 삭제했어요.{result.firstOccurredOn && result.lastOccurredOn ? ` (${formatPeriod(result.firstOccurredOn, result.lastOccurredOn)})` : ''}</Notice> : null}
        {deletedElsewhere ? <Notice tone="warning">‘{deletedElsewhere}’ 분류는 다른 구성원이 먼저 삭제했어요. 최신 목록을 불러왔습니다.</Notice> : null}
        {orderNotice?.kind === kind && orderNotice.result === 'saved' ? <Notice tone="success">분류 순서를 변경했어요.</Notice> : null}
        {orderNotice?.kind === kind && orderNotice.result === 'conflict' ? <Notice tone="warning">다른 구성원이 분류를 변경해 최신 순서를 불러왔어요. 다시 이동해 주세요.</Notice> : null}

        <form className="mt-6 grid gap-3 border-y border-[var(--line)] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={add}>
          <Field id="newCategoryName" label={`${kind === 'EXPENSE' ? '지출' : '수입'} 분류 추가`} value={addName} onChange={(event) => { setAddName(event.target.value); create.reset() }} maxLength={100} placeholder="예: 반려동물" required error={create.error instanceof ApiError && create.error.status === 409 ? '이미 같은 이름의 분류가 있어요.' : undefined} />
          <Button type="submit" disabled={!online || !addName.trim() || create.isPending}>{create.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}추가</Button>
        </form>

        {create.error && !(create.error instanceof ApiError && create.error.status === 409) ? <ErrorNotice error={create.error} /> : null}
        {missingDraft ? (
          <section className="mt-5 border-l-4 border-amber-500 px-4 py-2" aria-labelledby="missing-category-title">
            <h2 id="missing-category-title" className="font-semibold">다른 구성원이 이 분류를 먼저 삭제했어요</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">수정하던 이름 ‘{missingDraft.name}’은 유지했어요. 새 분류로 다시 만들거나 복사할 수 있어요.</p>
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={() => { setAddName(missingDraft.name); setMissingDraft(undefined); setEdit(undefined) }}><Plus size={17} />새 분류로 입력</Button><Button type="button" variant="secondary" onClick={copyMissingName}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '복사됨' : '이름 복사'}</Button><Button asChild type="button" variant="ghost"><Link to="/settings">설정으로 돌아가기</Link></Button></div>
          </section>
        ) : null}

        {conflict ? (
          <section className="mt-5 border-l-4 border-amber-500 px-4 py-2" aria-labelledby="category-conflict-title">
            <h2 id="category-conflict-title" className="font-semibold">다른 구성원이 먼저 변경했어요</h2>
            <dl className="mt-2 grid gap-1 text-sm"><div><dt className="inline text-[var(--muted)]">최신 이름 </dt><dd className="inline font-semibold">{conflict.latest.name}</dd></div>{conflict.action === 'rename' ? <div><dt className="inline text-[var(--muted)]">내 입력 </dt><dd className="inline font-semibold">{conflict.draftName}</dd></div> : null}</dl>
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={rebaseConflict}><Check size={17} />최신 버전에 {conflict.action === 'rename' ? '내 이름 적용' : '삭제 적용'}</Button><Button type="button" variant="secondary" onClick={() => { setConflict(undefined); setEdit(undefined); setPendingDelete(undefined); rename.reset(); remove.reset() }}><RotateCcw size={17} />최신값 유지</Button></div>
          </section>
        ) : null}

        <section className="mt-7" aria-labelledby="category-list-title">
          <div className="flex items-baseline justify-between gap-3"><h2 id="category-list-title" className="text-xl font-semibold">{kind === 'EXPENSE' ? '지출' : '수입'} 분류</h2><span className="text-sm text-[var(--muted)]">{categories.data?.length ?? 0}개</span></div>
          {categories.isPending ? <Loading /> : categories.isError ? <LoadError onRetry={() => categories.refetch()} /> : (
            <div className="mt-3 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)] lg:gap-8">
              <SortableCategoryGrid
                categories={categories.data ?? []}
                kindLabel={kind === 'EXPENSE' ? '지출' : '수입'}
                selectedCategoryId={selectedCategoryId}
                disabled={!online || reorder.isPending}
                onSelect={selectCategory}
                onReorder={(ordered) => reorder.mutate({ kind, categories: ordered })}
              />

              <div id="selected-category-panel" className="border-t border-[var(--line)] pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                {selectedCategory ? (
                  edit?.categoryId === selectedCategory.categoryId ? (
                    <form className="grid gap-3" onSubmit={saveRename}>
                      <Field id={`category-${selectedCategory.categoryId}`} label={`${selectedCategory.name} 이름 수정`} value={edit.name} onChange={(event) => { setEdit({ ...edit, name: event.target.value }); rename.reset() }} maxLength={100} required error={rename.error instanceof ApiError && rename.error.status === 409 ? '이미 같은 이름의 분류가 있어요.' : undefined} />
                      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!online || !edit.name.trim() || rename.isPending}>{rename.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}저장</Button><Button type="button" variant="ghost" onClick={() => { setEdit(undefined); rename.reset() }}>취소</Button></div>
                    </form>
                  ) : (
                    <div>
                      <p className="break-words font-semibold">{selectedCategory.name}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">연결된 거래 {selectedCategory.transactionCount}건</p>
                      {selectedCategory.isFallback ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">삭제된 {kind === 'EXPENSE' ? '지출' : '수입'} 분류의 거래가 이 기본 기타로 이동해요. 이름은 바꿀 수 있지만 삭제할 수 없습니다.</p> : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" aria-label={`${selectedCategory.name} 이름 수정`} onClick={() => { setEdit({ categoryId: selectedCategory.categoryId, name: selectedCategory.name, expectedVersion: selectedCategory.version }); setPendingDelete(undefined); setConflict(undefined); rename.reset() }}><Pencil size={17} />이름 수정</Button>
                        {!selectedCategory.isFallback ? <Button type="button" variant="ghost" aria-label={`${selectedCategory.name} 삭제`} onClick={() => { setPendingDelete(selectedCategory); setEdit(undefined); setConflict(undefined); setDeletedElsewhere(''); remove.reset() }}><Trash2 size={17} />삭제</Button> : null}
                      </div>
                    </div>
                  )
                ) : <p className="text-sm text-[var(--muted)]">수정할 분류를 선택해 주세요.</p>}
              </div>
            </div>
          )}
        </section>

        {reorder.error && !(reorder.error instanceof ApiError && reorder.error.status === 412) ? <ErrorNotice error={reorder.error} /> : null}

        {pendingDelete ? (
          <section className="mt-5 border-y border-[var(--line)] py-5" aria-labelledby="delete-category-title">
            <h2 id="delete-category-title" className="text-lg font-semibold">‘{pendingDelete.name}’ 분류를 삭제할까요?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">연결된 거래 {pendingDelete.transactionCount}건은 {fallback ? `‘${fallback.name}’` : '같은 종류의 ‘기타’'} 분류로 옮겨져요. 거래 자체는 삭제되지 않습니다.</p>
            {remove.error && !(remove.error instanceof ApiError && [404, 412].includes(remove.error.status)) ? <ErrorNotice error={remove.error} /> : null}
            <div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="destructive" disabled={!online || remove.isPending} onClick={() => remove.mutate(pendingDelete)}>{remove.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}분류 삭제</Button><Button type="button" variant="secondary" onClick={() => { setPendingDelete(undefined); remove.reset() }}>취소</Button></div>
          </section>
        ) : null}
      </section>
    </AppShell>
  )
}

function KindButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button variant="ghost" className={`rounded-none px-3 first:border-r first:border-[var(--line)] ${active ? 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-white' : 'bg-[var(--surface)] text-[var(--muted)] hover:text-ink-900 dark:hover:text-white'}`} type="button" aria-pressed={active} onClick={onClick}>{children}</Button>
}

function Notice({ tone, children }: { tone: 'warning' | 'success'; children: ReactNode }) {
  return <p className={`mt-4 border-l-4 px-4 py-2 text-sm ${tone === 'warning' ? 'border-amber-500 text-amber-900 dark:text-[#ffe3a3]' : 'border-forest-600 text-forest-800 dark:text-forest-100'}`} role="status">{children}</p>
}

function ErrorNotice({ error }: { error: unknown }) {
  return <p className="mt-4 border-l-4 border-red-600 px-4 py-2 text-sm text-red-800 dark:text-[#ffd5cf]" role="alert">{error instanceof Error ? error.message : '요청을 처리하지 못했어요.'}</p>
}

function Loading() { return <div className="grid min-h-40 place-items-center text-sm text-[var(--muted)]"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={17} />분류를 불러오는 중…</span></div> }
function LoadError({ onRetry }: { onRetry: () => void }) { return <div className="mt-3 border-y border-[var(--line)] py-8 text-center"><p role="alert">분류를 불러오지 못했어요.</p><Button className="mt-3" variant="secondary" onClick={onRetry}>다시 불러오기</Button></div> }
function formatPeriod(first: string, last: string) { return first === last ? first : `${first}~${last}` }
