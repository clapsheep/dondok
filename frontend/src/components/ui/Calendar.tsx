import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import type { ComponentProps } from 'react'
import { DayPicker, getDefaultClassNames, type ChevronProps } from 'react-day-picker'
import { ko } from 'react-day-picker/locale'
import { cn } from '../../lib/cn'

type Props = ComponentProps<typeof DayPicker>

export function Calendar({ className, classNames, ...props }: Props) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      locale={ko}
      timeZone="Asia/Seoul"
      showOutsideDays
      fixedWeeks
      navLayout="around"
      className={cn('relative w-full select-none', className)}
      classNames={{
        root: cn('relative w-full', defaultClassNames.root),
        months: cn('flex w-full flex-col', defaultClassNames.months),
        month: cn('w-full space-y-2', defaultClassNames.month),
        nav: cn('absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between', defaultClassNames.nav),
        button_previous: cn('grid size-11 place-items-center rounded-md text-forest-700 hover:bg-forest-50 dark:text-forest-100 dark:hover:bg-forest-800', defaultClassNames.button_previous),
        button_next: cn('grid size-11 place-items-center rounded-md text-forest-700 hover:bg-forest-50 dark:text-forest-100 dark:hover:bg-forest-800', defaultClassNames.button_next),
        month_caption: cn('flex h-11 items-center justify-center px-12', defaultClassNames.month_caption),
        caption_label: cn('text-sm font-semibold tabular-nums', defaultClassNames.caption_label),
        month_grid: cn('w-full table-fixed border-collapse', defaultClassNames.month_grid),
        weekdays: cn('border-b border-[var(--line)]', defaultClassNames.weekdays),
        weekday: cn('h-8 text-center text-xs font-medium text-[var(--muted)]', defaultClassNames.weekday),
        week: cn('border-b border-[var(--line)] last:border-b-0', defaultClassNames.week),
        day: cn('h-11 p-0 text-center align-middle', defaultClassNames.day),
        day_button: cn('mx-auto grid size-10 place-items-center rounded-md text-sm tabular-nums transition-colors hover:bg-forest-50 hover:text-forest-800 focus-visible:relative focus-visible:z-20 dark:hover:bg-forest-800 dark:hover:text-white', defaultClassNames.day_button),
        selected: cn('[&>button]:bg-forest-700 [&>button]:font-semibold [&>button]:text-white [&>button]:hover:bg-forest-800 [&>button]:hover:text-white', defaultClassNames.selected),
        today: cn('[&>button]:border [&>button]:border-forest-700 [&>button]:font-semibold dark:[&>button]:border-forest-100', defaultClassNames.today),
        outside: cn('[&>button]:text-[var(--muted)] [&>button]:opacity-40', defaultClassNames.outside),
        disabled: cn('[&>button]:pointer-events-none [&>button]:opacity-30', defaultClassNames.disabled),
        hidden: cn('invisible', defaultClassNames.hidden),
        footer: cn('sr-only', defaultClassNames.footer),
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron }}
      {...props}
    />
  )
}

function CalendarChevron({ orientation = 'right', size = 18, className, disabled, style }: ChevronProps) {
  const Icon = orientation === 'left'
    ? ChevronLeft
    : orientation === 'up'
      ? ChevronUp
      : orientation === 'down'
        ? ChevronDown
        : ChevronRight

  return <Icon className={className} size={size} aria-hidden="true" aria-disabled={disabled} style={style} />
}
