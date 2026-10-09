import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import type { ComponentProps } from 'react'
import { DayPicker, getDefaultClassNames, type ChevronProps } from 'react-day-picker'
import { ko } from 'react-day-picker/locale'
import { cn } from '../../lib/cn'

type Props = ComponentProps<typeof DayPicker>

export function Calendar({ className, classNames, modifiers, modifiersClassNames, ...props }: Props) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      locale={ko}
      timeZone="Asia/Seoul"
      showOutsideDays
      fixedWeeks
      navLayout="around"
      modifiers={{ sunday: { dayOfWeek: [0] }, saturday: { dayOfWeek: [6] }, ...modifiers }}
      modifiersClassNames={{ sunday: 'dondok-calendar-sunday', saturday: 'dondok-calendar-saturday', ...modifiersClassNames }}
      className={cn('relative w-full select-none', className)}
      classNames={{
        root: cn('relative w-full', defaultClassNames.root),
        months: cn('flex w-full flex-col', defaultClassNames.months),
        // With navLayout="around", arrows and caption are siblings of the
        // month grid (there is no Nav wrapper). Reserve their own grid cells
        // so container width, zoom and caption length cannot stack them.
        month: cn('grid w-full min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-y-2', defaultClassNames.month),
        nav: cn('absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between', defaultClassNames.nav),
        button_previous: cn('col-start-1 row-start-1 grid size-11 place-items-center rounded-md text-forest-700 hover:bg-[var(--surface-hover)] dark:text-forest-100', defaultClassNames.button_previous),
        button_next: cn('col-start-3 row-start-1 grid size-11 place-items-center rounded-md text-forest-700 hover:bg-[var(--surface-hover)] dark:text-forest-100', defaultClassNames.button_next),
        month_caption: cn('col-start-2 row-start-1 flex min-h-11 min-w-0 items-center justify-center', defaultClassNames.month_caption),
        caption_label: cn('whitespace-nowrap text-sm font-semibold tabular-nums', defaultClassNames.caption_label),
        month_grid: cn('col-span-full w-full table-fixed border-collapse', defaultClassNames.month_grid),
        weekdays: cn('', defaultClassNames.weekdays),
        weekday: cn('h-8 text-center text-xs font-medium text-[var(--muted)]', defaultClassNames.weekday),
        week: cn('', defaultClassNames.week),
        day: cn('h-11 p-0 text-center align-middle', defaultClassNames.day),
        day_button: cn('mx-auto grid size-10 place-items-center rounded-full text-sm tabular-nums transition-colors hover:bg-[var(--surface-hover)] hover:text-forest-800 focus-visible:relative focus-visible:z-20 dark:hover:text-[var(--foreground)]', defaultClassNames.day_button),
        selected: cn('[&>button]:bg-[var(--selection)] [&>button]:font-semibold [&>button]:text-[var(--background)] [&>button]:hover:bg-[var(--selection)] [&>button]:hover:text-[var(--background)]', defaultClassNames.selected),
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
