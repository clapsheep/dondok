package com.dondok.settlement.application;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Retired automatic execution facade; historical records use CardStatementService. */
@Service
public class CardSettlementService {
    public List<UUID> dueScheduleIds() { return List.of(); }
    public SettlementOutcome settle(UUID scheduleId) { return SettlementOutcome.SKIPPED; }
    public void recordFailure(UUID scheduleId, RuntimeException failure) {}

    public enum SettlementOutcome {
        PAID,
        COMPLETED_WITHOUT_PAYMENT,
        CANCELLED,
        SKIPPED
    }
}
