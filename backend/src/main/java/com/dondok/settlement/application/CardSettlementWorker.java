package com.dondok.settlement.application;

import org.springframework.stereotype.Component;

/** Compatibility facade. Automatic card payments were retired by D-069. */
@Component
public class CardSettlementWorker {
    public SettlementRunResult runDueSettlements() {
        return new SettlementRunResult(0, 0, 0, 0);
    }
    public record SettlementRunResult(int paid, int completedWithoutPayment, int cancelled, int failed) {}
}
