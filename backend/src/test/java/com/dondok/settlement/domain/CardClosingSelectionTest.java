package com.dondok.settlement.domain;

import static org.assertj.core.api.Assertions.assertThat;
import com.dondok.settlement.application.CardPaymentItemService;
import java.time.LocalDate;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class CardClosingSelectionTest {
    @ParameterizedTest
    @CsvSource({"2026-10-12,31,2026-09-30", "2026-10-30,31,2026-09-30", "2026-10-31,31,2026-10-31",
        "2026-02-28,31,2026-02-28", "2028-02-29,31,2028-02-29", "2028-02-28,31,2028-01-31",
        "2026-01-01,14,2025-12-14", "2026-10-14,14,2026-10-14"})
    void latestCompletedClosingDate(String today, int closingDay, String expected) {
        assertThat(CardPaymentItemService.latestClosing(LocalDate.parse(today), closingDay)).isEqualTo(LocalDate.parse(expected));
    }
}
