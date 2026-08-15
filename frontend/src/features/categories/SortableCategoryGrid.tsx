import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import type { Category } from './api'

type Props = {
  categories: Category[]
  kindLabel: string
  selectedCategoryId?: string
  disabled: boolean
  onSelect: (category: Category) => void
  onReorder: (categories: Category[]) => void
}

export function SortableCategoryGrid({ categories, kindLabel, selectedCategoryId, disabled, onSelect, onReorder }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function finishDrag(event: DragEndEvent) {
    const overId = event.over?.id
    if (!overId || event.active.id === overId || disabled) return
    const previousIndex = categories.findIndex((category) => category.categoryId === event.active.id)
    const nextIndex = categories.findIndex((category) => category.categoryId === overId)
    if (previousIndex < 0 || nextIndex < 0) return
    onReorder(arrayMove(categories, previousIndex, nextIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={finishDrag}
      accessibility={{
        screenReaderInstructions: {
          draggable: '순서 이동 버튼에서 스페이스를 누른 뒤 방향키로 옮기고, 다시 스페이스를 눌러 놓으세요.',
        },
        announcements: {
          onDragStart: ({ active }) => `이동 시작: ${categoryName(categories, active.id)}`,
          onDragOver: ({ active, over }) => over ? `이동 중: ${categoryName(categories, active.id)} → ${categoryName(categories, over.id)} 위치` : undefined,
          onDragEnd: ({ active, over }) => over ? `이동 완료: ${categoryName(categories, active.id)} → ${categoryName(categories, over.id)} 위치` : `이동 취소: ${categoryName(categories, active.id)}`,
          onDragCancel: ({ active }) => `이동 취소: ${categoryName(categories, active.id)}`,
        },
      }}
    >
      <SortableContext items={categories.map((category) => category.categoryId)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(9rem,100%),1fr))] gap-2" role="group" aria-label={`${kindLabel} 분류 선택`}>
          {categories.map((category) => (
            <SortableCategory
              key={category.categoryId}
              category={category}
              selected={category.categoryId === selectedCategoryId}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableCategory({ category, selected, disabled, onSelect }: { category: Category; selected: boolean; disabled: boolean; onSelect: (category: Category) => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.categoryId,
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 items-stretch rounded-md border transition-[border-color,background-color,opacity] ${selected ? 'border-forest-700 bg-forest-50 dark:bg-forest-950' : 'border-[var(--line)] bg-transparent hover:border-forest-600 hover:bg-forest-50 dark:hover:bg-forest-950'} ${isDragging ? 'z-10 opacity-70 shadow-md' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-category-sortable
      data-category-id={category.categoryId}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="min-h-11 shrink-0 cursor-grab touch-none rounded-r-none border-r border-[var(--line-subtle)] px-0 active:cursor-grabbing"
        aria-label={`${category.name} 순서 이동`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={17} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={`min-h-11 min-w-0 flex-1 whitespace-normal rounded-l-none px-2.5 py-2 text-sm leading-5 hover:bg-transparent ${selected ? 'font-semibold text-forest-800 dark:text-forest-100' : 'font-medium text-ink-900 dark:text-white'}`}
        aria-pressed={selected}
        aria-controls="selected-category-panel"
        title={category.name}
        data-category-select
        onClick={() => onSelect(category)}
      >
        <span className="line-clamp-2 break-words">{category.name}</span>
      </Button>
    </div>
  )
}

function categoryName(categories: Category[], id: string | number) {
  return categories.find((category) => category.categoryId === String(id))?.name ?? '분류'
}
