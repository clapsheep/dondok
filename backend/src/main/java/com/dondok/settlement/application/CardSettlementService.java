package com.dondok.settlement.application;

import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository;
import com.dondok.settlement.domain.CardStatementPaymentPolicy;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository.ScheduleRow;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository.StatementRow;
import com.dondok.transaction.application.ManagedTransferPort;
import com.dondok.transaction.domain.TransferSubtype;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CardSettlementService {
    private static final ZoneId SERVICE_ZONE = ZoneId.of("Asia/Seoul");
    private static final int BATCH_SIZE = 50;

    private final CardSettlementRepository repository;
    private final ManagedTransferPort managedTransfers;
    private final CardStatementPaymentPolicy paymentPolicy;
    private final LedgerMutationGuard mutationGuard;
    private final Clock clock;

    public CardSettlementService(
            CardSettlementRepository repository,
            ManagedTransferPort managedTransfers,
            CardStatementPaymentPolicy paymentPolicy,
            LedgerMutationGuard mutationGuard,
            Clock clock
    ) {
        this.repository = repository;
        this.managedTransfers = managedTransfers;
        this.paymentPolicy = paymentPolicy;
        this.mutationGuard = mutationGuard;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<UUID> dueScheduleIds() {
        Instant now = clock.instant();
        return repository.dueScheduleIds(today(now), now, BATCH_SIZE);
    }

    @Transactional
    public SettlementOutcome settle(UUID scheduleId) {
        Instant now = clock.instant();
        LocalDate today = today(now);
        UUID bookId = repository.findScheduleBookId(scheduleId);
        if (bookId == null || mutationGuard.tryLockBook(bookId).isEmpty()) {
            return SettlementOutcome.SKIPPED;
        }
        ScheduleRow schedule = repository.lockSchedule(scheduleId);
        if (schedule == null || !schedule.bookId().equals(bookId)
                || List.of("COMPLETED", "CANCELLED").contains(schedule.status())
                || schedule.scheduledOn().isAfter(today)
                || ("FAILED".equals(schedule.status())
                && schedule.nextRetryAt() != null && schedule.nextRetryAt().isAfter(now))) {
            return SettlementOutcome.SKIPPED;
        }

        StatementRow statement = repository.lockStatement(schedule.bookId(), schedule.statementId());
        if (statement == null) {
            repository.cancelSchedule(scheduleId, now);
            return SettlementOutcome.CANCELLED;
        }
        if (!repository.isActiveAsset(statement.bookId(), statement.cardAssetId())) {
            repository.cancelSchedule(scheduleId, now);
            return SettlementOutcome.CANCELLED;
        }
        if (!statement.autoSettlementEnabled() || statement.settlementAssetId() == null) {
            repository.cancelSchedule(scheduleId, now);
            return SettlementOutcome.CANCELLED;
        }
        if (!statement.settlementAssetId().equals(schedule.settlementAssetId())) {
            repository.updateScheduleSettlementAsset(
                    scheduleId, statement.settlementAssetId(), now);
        }
        if ("CANCELLED".equals(statement.status())) {
            repository.cancelSchedule(scheduleId, now);
            return SettlementOutcome.CANCELLED;
        }
        if ("PAID".equals(statement.status())) {
            repository.completeSchedule(scheduleId, now);
            return SettlementOutcome.COMPLETED_WITHOUT_PAYMENT;
        }
        if (statement.remainingAmountWon() == 0) {
            repository.completeRegularSettlement(statement.statementId(), scheduleId, now);
            return SettlementOutcome.COMPLETED_WITHOUT_PAYMENT;
        }
        if (repository.regularPaymentExists(statement.statementId())) {
            repository.completeRegularSettlement(statement.statementId(), scheduleId, now);
            return SettlementOutcome.COMPLETED_WITHOUT_PAYMENT;
        }

        long amountWon = paymentPolicy.regularPayment(statement.remainingAmountWon());
        UUID paymentId = UuidV7.next();
        UUID transactionId = UuidV7.next();
        managedTransfers.create(new ManagedTransferPort.CreateCommand(
                transactionId, statement.bookId(), TransferSubtype.CARD_SETTLEMENT,
                schedule.scheduledOn(), amountWon, "카드대금 자동 정산", "CARD_AUTOPAY",
                scheduleId, null, now,
                List.of(
                        new ManagedTransferPort.Posting(
                                statement.settlementAssetId(), -amountWon),
                        new ManagedTransferPort.Posting(statement.cardAssetId(), amountWon))));
        repository.insertPayment(new CardSettlementRepository.PaymentWrite(
                paymentId, statement.bookId(), statement.statementId(), "REGULAR",
                statement.settlementAssetId(), amountWon, schedule.scheduledOn(),
                transactionId, null, now));
        repository.completeRegularSettlement(statement.statementId(), scheduleId, now);
        return SettlementOutcome.PAID;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(UUID scheduleId, RuntimeException failure) {
        Instant now = clock.instant();
        UUID bookId = repository.findScheduleBookId(scheduleId);
        if (bookId == null || mutationGuard.tryLockBook(bookId).isEmpty()) {
            return;
        }
        ScheduleRow schedule = repository.lockSchedule(scheduleId);
        if (schedule == null || !schedule.bookId().equals(bookId)
                || List.of("COMPLETED", "CANCELLED").contains(schedule.status())) {
            return;
        }
        int exponent = Math.min(schedule.attemptCount(), 6);
        Duration retryDelay = Duration.ofMinutes(5L * (1L << exponent));
        String error = failure.getClass().getSimpleName();
        repository.recordScheduleFailure(scheduleId, error, now.plus(retryDelay), now);
    }

    private LocalDate today(Instant now) {
        return now.atZone(SERVICE_ZONE).toLocalDate();
    }

    public enum SettlementOutcome {
        PAID,
        COMPLETED_WITHOUT_PAYMENT,
        CANCELLED,
        SKIPPED
    }
}
