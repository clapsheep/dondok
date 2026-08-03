package com.dondok.settlement.domain;

import org.springframework.stereotype.Component;

@Component
public class CardStatementPaymentPolicy {
    public PrepaymentDecision prepayment(long remainingAmountWon, long requestedAmountWon) {
        if (requestedAmountWon <= 0) {
            throw new PaymentAmountException(PaymentAmountError.NON_POSITIVE);
        }
        if (requestedAmountWon > remainingAmountWon) {
            throw new PaymentAmountException(PaymentAmountError.EXCEEDS_REMAINING);
        }
        long afterRemainingAmountWon = remainingAmountWon - requestedAmountWon;
        return new PrepaymentDecision(afterRemainingAmountWon, afterRemainingAmountWon == 0);
    }

    public long regularPayment(long remainingAmountWon) {
        if (remainingAmountWon < 0) {
            throw new IllegalArgumentException("remaining card statement amount cannot be negative");
        }
        return remainingAmountWon;
    }

    public record PrepaymentDecision(long afterRemainingAmountWon, boolean fullyPaid) {
    }

    public enum PaymentAmountError {
        NON_POSITIVE,
        EXCEEDS_REMAINING
    }

    public static final class PaymentAmountException extends RuntimeException {
        private final PaymentAmountError error;

        public PaymentAmountException(PaymentAmountError error) {
            super(error.name());
            this.error = error;
        }

        public PaymentAmountError error() {
            return error;
        }
    }
}
