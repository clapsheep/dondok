package com.dondok.asset.domain;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.function.Predicate;
import org.springframework.stereotype.Component;

@Component
public class CardBillingCyclePolicy {

    public Cycle calculate(
            LocalDate occurredOn,
            int closingDay,
            int paymentDay,
            int paymentMonthOffset,
            Predicate<LocalDate> publicHoliday
    ) {
        LocalDate cycleEnd = day(YearMonth.from(occurredOn), closingDay);
        if (occurredOn.isAfter(cycleEnd)) {
            cycleEnd = day(YearMonth.from(occurredOn).plusMonths(1), closingDay);
        }
        LocalDate previousEnd = day(YearMonth.from(cycleEnd).minusMonths(1), closingDay);
        LocalDate cycleStart = previousEnd.plusDays(1);
        LocalDate dueOn = day(YearMonth.from(cycleEnd).plusMonths(paymentMonthOffset), paymentDay);
        if (dueOn.isBefore(cycleEnd)) {
            dueOn = day(YearMonth.from(dueOn).plusMonths(1), paymentDay);
        }
        while (isWeekend(dueOn) || publicHoliday.test(dueOn)) {
            dueOn = dueOn.plusDays(1);
        }
        return new Cycle(cycleStart, cycleEnd, dueOn);
    }

    private LocalDate day(YearMonth month, int requestedDay) {
        return month.atDay(Math.min(requestedDay, month.lengthOfMonth()));
    }

    private boolean isWeekend(LocalDate date) {
        return date.getDayOfWeek() == DayOfWeek.SATURDAY || date.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    public record Cycle(LocalDate start, LocalDate end, LocalDate dueOn) {
    }
}
