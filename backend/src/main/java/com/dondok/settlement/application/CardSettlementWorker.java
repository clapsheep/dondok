package com.dondok.settlement.application;

import java.util.List;
import java.util.UUID;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CardSettlementWorker {
    private final CardSettlementService settlements;

    public CardSettlementWorker(CardSettlementService settlements) {
        this.settlements = settlements;
    }

    @Scheduled(
            initialDelayString = "${dondok.settlement.worker.initial-delay-ms:60000}",
            fixedDelayString = "${dondok.settlement.worker.fixed-delay-ms:60000}"
    )
    public SettlementRunResult runDueSettlements() {
        int paid = 0;
        int completedWithoutPayment = 0;
        int cancelled = 0;
        int failed = 0;
        while (true) {
            List<UUID> candidates = settlements.dueScheduleIds();
            if (candidates.isEmpty()) {
                break;
            }
            for (UUID scheduleId : candidates) {
                try {
                    CardSettlementService.SettlementOutcome outcome = settlements.settle(scheduleId);
                    switch (outcome) {
                        case PAID -> paid++;
                        case COMPLETED_WITHOUT_PAYMENT -> completedWithoutPayment++;
                        case CANCELLED -> cancelled++;
                        case SKIPPED -> { }
                    }
                } catch (RuntimeException failure) {
                    failed++;
                    settlements.recordFailure(scheduleId, failure);
                }
            }
            if (candidates.size() < 50) {
                break;
            }
        }
        return new SettlementRunResult(paid, completedWithoutPayment, cancelled, failed);
    }

    public record SettlementRunResult(
            int paid,
            int completedWithoutPayment,
            int cancelled,
            int failed
    ) {
    }
}
