package com.dondok.settlement.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.category.application.CategoryService;
import com.dondok.category.domain.CategoryKind;
import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import com.dondok.transaction.application.CardPurchaseManagementService;
import com.dondok.transaction.application.TransactionService;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import(CardStatementSettlementIntegrationTest.MutableClockConfiguration.class)
class CardStatementSettlementIntegrationTest {
    private static final Instant PREPAYMENT_NOW = Instant.parse("2026-07-18T03:00:00Z");

    @Autowired private CardStatementService statements;
    @Autowired private CardSettlementService settlementService;
    @Autowired private CardSettlementWorker worker;
    @Autowired private TransactionService transactionService;
    @Autowired private CardPurchaseManagementService purchaseManagement;
    @Autowired private AssetService assetService;
    @Autowired private CategoryService categoryService;
    @Autowired private MembershipService membershipService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private MutableClock mutableClock;

    private final List<UUID> users = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        jdbcTemplate.execute("""
                drop trigger if exists dondok_test_fail_autopay_trigger on ledger_transaction
                """);
        jdbcTemplate.execute("drop function if exists dondok_test_fail_autopay()");
        for (UUID userId : users) {
            jdbcTemplate.update("delete from ledger_book where created_by_user_id = ?", userId);
        }
        for (UUID userId : users) {
            jdbcTemplate.update("delete from app_user where id = ?", userId);
        }
        mutableClock.set(PREPAYMENT_NOW);
    }

    @Test
    void multiplePrepaymentsAreIdempotentExcludeStatisticsAndAllowNegativeAccount() {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(fixture, 120_000, "multi-purchase");
        UUID statementId = statementId(purchase.transactionId());

        CardStatementService.CardStatementPage page = statements.statements(
                fixture.userId(), fixture.card().assetId(), null, 20, false);
        assertThat(page.items()).singleElement().satisfies(item -> {
            assertThat(item.statementId()).isEqualTo(statementId);
            assertThat(item.remainingAmountWon()).isEqualTo(120_000);
            assertThat(item.automaticSettlement().status()).isEqualTo("SCHEDULED");
        });

        CardStatementService.CardStatementDetail beforeFirst = statements.statement(
                fixture.userId(), statementId);
        CardStatementService.CardStatementPrepaymentPreview firstPreview = statements.preview(
                fixture.userId(), statementId,
                new CardStatementService.PrepaymentCommand(30_000, beforeFirst.version()));
        CardStatementService.PrepaymentApplyCommand firstCommand =
                new CardStatementService.PrepaymentApplyCommand(
                        30_000, beforeFirst.version(), firstPreview.previewToken());
        CardStatementService.CardStatementPaymentResult first = statements.prepay(
                fixture.userId(), statementId, "prepay-30", firstCommand);
        CardStatementService.CardStatementPaymentResult replay = statements.prepay(
                fixture.userId(), statementId, "prepay-30", firstCommand);
        assertThat(replay.payment().paymentId()).isEqualTo(first.payment().paymentId());
        CardStatementService.CardStatementDetail afterFirst = statements.statement(
                fixture.userId(), statementId);
        CardStatementService.CardStatementPrepaymentPreview reusedKeyPreview = statements.preview(
                fixture.userId(), statementId,
                new CardStatementService.PrepaymentCommand(20_000, afterFirst.version()));
        assertThatThrownBy(() -> statements.prepay(
                fixture.userId(), statementId, "prepay-30",
                new CardStatementService.PrepaymentApplyCommand(
                        20_000, afterFirst.version(), reusedKeyPreview.previewToken())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("IDEMPOTENCY_KEY_REUSED"));
        assertThat(queryLong(
                "select count(*) from card_statement_payment where statement_id = ?", statementId))
                .isOne();

        CardStatementService.CardStatementPaymentResult second = prepay(
                fixture, statementId, 40_000, "prepay-40");
        assertThat(second.statement().remainingAmountWon()).isEqualTo(50_000);
        assertThat(second.statement().payments()).hasSize(2);
        assertThat(second.settlementTransaction().performedBy()).isNull();
        assertThat(second.settlementTransaction().createdBy().memberId()).isEqualTo(fixture.memberId());
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-70_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-50_000);
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'PREPAYMENT'
                """, statementId)).isEqualTo(2);

        TransactionService.CalendarView calendar = transactionService.calendar(
                fixture.userId(), java.time.YearMonth.of(2026, 7));
        assertThat(calendar.totalExpenseWon()).isEqualTo(120_000);
        assertThat(calendar.totalIncomeWon()).isZero();
    }

    @Test
    void cancellingPrepaymentAtomicallyRestoresBalancesAndReopensStatement() {
        Fixture fixture = fixture(true, 200_000);
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "cancel-prepayment-purchase");
        UUID statementId = statementId(purchase.transactionId());
        CardStatementService.CardStatementPaymentResult paid = prepay(
                fixture, statementId, 100_000, "cancel-prepayment");

        assertThat(paid.statement().status()).isEqualTo("PAID");
        assertThat(balance(fixture.bank().assetId())).isEqualTo(100_000);
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(scheduleStatus(statementId)).isEqualTo("COMPLETED");

        TransactionService.TransactionView transactionDetail = transactionService.transaction(
                fixture.userId(), paid.settlementTransaction().transactionId());
        assertThat(transactionDetail.cardPayment()).satisfies(reference -> {
            assertThat(reference.statementId()).isEqualTo(statementId);
            assertThat(reference.paymentId()).isEqualTo(paid.payment().paymentId());
            assertThat(reference.paymentType()).isEqualTo("PREPAYMENT");
            assertThat(reference.statementVersion()).isEqualTo(paid.statement().version());
            assertThat(reference.returnedAmountWon()).isZero();
        });

        CardStatementService.CardPrepaymentCancellationResult cancelled = statements.cancelPrepayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPrepaymentCommand(paid.statement().version()));

        assertThat(cancelled.statement().status()).isEqualTo("OPEN");
        assertThat(cancelled.statement().remainingAmountWon()).isEqualTo(100_000);
        assertThat(cancelled.statement().payments()).isEmpty();
        assertThat(cancelled.cancelledPaymentId()).isEqualTo(paid.payment().paymentId());
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-100_000);
        assertThat(scheduleStatus(statementId)).isEqualTo("SCHEDULED");
        assertThat(queryLong("""
                select count(*) from ledger_transaction
                 where id = ? and deleted_at is not null
                """, paid.settlementTransaction().transactionId())).isOne();
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where id = ? and cancelled_at is not null
                """, paid.payment().paymentId())).isOne();
    }

    @Test
    void cancellingPrepaymentRejectsStaleVersionAndDuplicateCancellation() {
        Fixture fixture = fixture(true, 200_000);
        UUID statementId = statementId(purchase(fixture, 100_000, "cancel-guard-purchase").transactionId());
        CardStatementService.CardStatementPaymentResult paid = prepay(
                fixture, statementId, 40_000, "cancel-guard-prepayment");

        assertThatThrownBy(() -> statements.cancelPrepayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPrepaymentCommand(paid.statement().version() - 1)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));

        CardStatementService.CardPrepaymentCancellationResult cancelled = statements.cancelPrepayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPrepaymentCommand(paid.statement().version()));
        assertThatThrownBy(() -> statements.cancelPrepayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPrepaymentCommand(cancelled.statement().version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_PREPAYMENT_ALREADY_CANCELLED"));
    }

    @Test
    void correctsPaymentAccountWithoutChangingAmountDateOrStatementSettlement() {
        Fixture fixture = fixture(true, 200_000);
        AssetService.AssetView correctedBank = createBank(
                fixture, "정정 결제 계좌", 50_000, "corrected-payment-bank");
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "payment-account-correction-purchase");
        UUID statementId = statementId(purchase.transactionId());
        CardStatementService.CardStatementPaymentResult paid = prepay(
                fixture, statementId, 60_000, "payment-account-correction");
        long statementVersion = paid.statement().version();

        CardStatementService.CardStatementPaymentResult corrected =
                statements.correctPaymentAccount(
                        fixture.userId(), statementId, paid.payment().paymentId(),
                        new CardStatementService.CorrectPaymentAccountCommand(
                                correctedBank.assetId(), statementVersion));

        assertThat(corrected.payment().settlementAssetId()).isEqualTo(correctedBank.assetId());
        assertThat(corrected.payment().amountWon()).isEqualTo(60_000);
        assertThat(corrected.payment().paidOn()).isEqualTo(paid.payment().paidOn());
        assertThat(corrected.statement().remainingAmountWon()).isEqualTo(40_000);
        assertThat(corrected.statement().version()).isEqualTo(statementVersion + 1);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(correctedBank.assetId())).isEqualTo(-10_000);
        assertThat(corrected.settlementTransaction().postings())
                .anySatisfy(posting -> {
                    assertThat(posting.assetId()).isEqualTo(correctedBank.assetId());
                    assertThat(posting.deltaWon()).isEqualTo(-60_000);
                });

        assertThatThrownBy(() -> statements.correctPaymentAccount(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CorrectPaymentAccountCommand(
                        fixture.bank().assetId(), statementVersion)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("VERSION_CONFLICT"));
    }

    @Test
    void correctsCompletedAutomaticSettlementAccountAndScheduleTogether() {
        Fixture fixture = fixture(true, 200_000);
        AssetService.AssetView correctedBank = createBank(
                fixture, "자동 정산 정정 계좌", 300_000, "corrected-regular-payment-bank");
        TransactionService.TransactionView purchase = purchase(
                fixture, 80_000, "regular-payment-account-correction-purchase");
        UUID statementId = statementId(purchase.transactionId());
        UUID scheduleId = scheduleId(statementId);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        assertThat(settlementService.settle(scheduleId))
                .isEqualTo(CardSettlementService.SettlementOutcome.PAID);
        CardStatementService.CardStatementDetail paid = statements.statement(
                fixture.userId(), statementId);
        CardStatementService.CardStatementPayment regular = paid.payments().stream()
                .filter(payment -> payment.paymentType().equals("REGULAR"))
                .findFirst().orElseThrow();

        CardStatementService.CardStatementPaymentResult corrected =
                statements.correctPaymentAccount(
                        fixture.userId(), statementId, regular.paymentId(),
                        new CardStatementService.CorrectPaymentAccountCommand(
                                correctedBank.assetId(), paid.version()));

        assertThat(corrected.statement().status()).isEqualTo("PAID");
        assertThat(corrected.statement().remainingAmountWon()).isZero();
        assertThat(corrected.payment().paidOn()).isEqualTo(regular.paidOn());
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(correctedBank.assetId())).isEqualTo(220_000);
        assertThat(jdbcTemplate.queryForObject("""
                select settlement_asset_id from card_payment_schedule where id = ?
                """, UUID.class, scheduleId)).isEqualTo(correctedBank.assetId());
    }

    @Test
    void staleConcurrentPrepaymentsCommitOnlyOnePayment() throws Exception {
        Fixture fixture = fixture(false, 0);
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "race-purchase");
        UUID statementId = statementId(purchase.transactionId());
        CardStatementService.CardStatementDetail detail = statements.statement(
                fixture.userId(), statementId);
        CardStatementService.CardStatementPrepaymentPreview preview = statements.preview(
                fixture.userId(), statementId,
                new CardStatementService.PrepaymentCommand(70_000, detail.version()));

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Object>> attempts = List.of(
                    executor.submit(() -> concurrentPrepay(
                            fixture, statementId, preview, "race-a", ready, start)),
                    executor.submit(() -> concurrentPrepay(
                            fixture, statementId, preview, "race-b", ready, start)));
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Object> results = List.of(attempts.get(0).get(), attempts.get(1).get());
            assertThat(results.stream().filter(CardStatementService.CardStatementPaymentResult.class::isInstance))
                    .hasSize(1);
            assertThat(results.stream().filter(ApiException.class::isInstance)
                    .map(ApiException.class::cast).map(ApiException::getErrorCode))
                    .containsExactly("CARD_STATEMENT_PREVIEW_STALE");
        } finally {
            executor.shutdownNow();
        }
        assertThat(queryLong("select count(*) from card_statement_payment where statement_id = ?", statementId))
                .isOne();
        assertThat(statements.statement(fixture.userId(), statementId).remainingAmountWon())
                .isEqualTo(30_000);
    }

    @Test
    void dueWorkerSettlesRemainingAmountOnceOnScheduledDateAndCatchesUp() throws Exception {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(fixture, 120_000, "worker-purchase");
        UUID statementId = statementId(purchase.transactionId());
        prepay(fixture, statementId, 30_000, "worker-prepay-30");
        prepay(fixture, statementId, 40_000, "worker-prepay-40");
        UUID scheduleId = scheduleId(statementId);
        LocalDate scheduledOn = jdbcTemplate.queryForObject(
                "select scheduled_on from card_payment_schedule where id = ?",
                LocalDate.class, scheduleId);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));

        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<CardSettlementService.SettlementOutcome> first = executor.submit(() -> {
                start.await();
                return settlementService.settle(scheduleId);
            });
            Future<CardSettlementService.SettlementOutcome> second = executor.submit(() -> {
                start.await();
                return settlementService.settle(scheduleId);
            });
            start.countDown();
            assertThat(List.of(first.get(), second.get()))
                    .contains(CardSettlementService.SettlementOutcome.PAID,
                            CardSettlementService.SettlementOutcome.SKIPPED);
        } finally {
            executor.shutdownNow();
        }

        CardStatementService.CardStatementDetail paid = statements.statement(
                fixture.userId(), statementId);
        assertThat(paid.status()).isEqualTo("PAID");
        assertThat(paid.remainingAmountWon()).isZero();
        assertThat(paid.payments()).extracting(CardStatementService.CardStatementPayment::paymentType)
                .containsExactlyInAnyOrder("PREPAYMENT", "PREPAYMENT", "REGULAR");
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'REGULAR'
                """, statementId)).isOne();
        assertThat(jdbcTemplate.queryForObject("""
                select transaction.occurred_on
                  from card_statement_payment payment
                  join ledger_transaction transaction
                    on transaction.id = payment.settlement_transaction_id
                 where payment.statement_id = ? and payment.payment_type = 'REGULAR'
                """, LocalDate.class, statementId)).isEqualTo(scheduledOn);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-120_000);
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(settlementService.settle(scheduleId))
                .isEqualTo(CardSettlementService.SettlementOutcome.SKIPPED);
        assertThat(queryLong("""
                select count(*) from ledger_transaction
                 where book_id = ? and source_type = 'CARD_AUTOPAY'
                """, fixture.bookId())).isOne();
    }

    @Test
    void workerEntryPointCatchesUpPastDueScheduleAndRestartDoesNotDuplicateIt() {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(
                fixture, 35_000, "worker-entry-purchase");
        UUID statementId = statementId(purchase.transactionId());
        UUID scheduleId = scheduleId(statementId);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));

        worker.runDueSettlements();

        assertThat(statements.statement(fixture.userId(), statementId).status()).isEqualTo("PAID");
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'REGULAR'
                """, statementId)).isOne();
        assertThat(settlementService.settle(scheduleId))
                .isEqualTo(CardSettlementService.SettlementOutcome.SKIPPED);
        assertThat(queryLong("""
                select count(*) from ledger_transaction
                 where book_id = ? and source_type = 'CARD_AUTOPAY'
                """, fixture.bookId())).isOne();
    }

    @Test
    void fullPrepaymentIsPaidAndCorrectionIncreaseReopensAndReactivatesSchedule() {
        Fixture fixture = fixture(true, 100_000);
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "full-purchase");
        UUID statementId = statementId(purchase.transactionId());
        CardStatementService.CardStatementPaymentResult fullyPaid = prepay(
                fixture, statementId, 100_000, "full-prepayment");
        assertThat(fullyPaid.statement().status()).isEqualTo("PAID");
        assertThat(scheduleStatus(statementId)).isEqualTo("COMPLETED");

        CardPurchaseManagementService.CorrectionCommand correction =
                new CardPurchaseManagementService.CorrectionCommand(
                        purchase.occurredOn(), 150_000, fixture.expenseCategoryId(),
                        fixture.card().assetId(), fixture.memberId(), purchase.description(),
                        1, purchase.version());
        CardPurchaseManagementService.CardPurchaseCorrectionPreview preview =
                purchaseManagement.previewCorrection(
                        fixture.userId(), purchase.transactionId(), correction);
        purchaseManagement.correct(
                fixture.userId(), purchase.transactionId(), "increase-after-full-prepay",
                new CardPurchaseManagementService.CorrectionApplyCommand(
                        correction.occurredOn(), correction.amountWon(), correction.categoryId(),
                        correction.cardAssetId(), correction.performedByMemberId(),
                        correction.description(), correction.installmentCount(),
                        correction.expectedVersion(), preview.previewToken()));

        CardStatementService.CardStatementDetail reopened = statements.statement(
                fixture.userId(), statementId);
        assertThat(reopened.status()).isEqualTo("OPEN");
        assertThat(reopened.remainingAmountWon()).isEqualTo(50_000);
        assertThat(reopened.automaticSettlement().status()).isEqualTo("SCHEDULED");
    }

    @Test
    void dueWorkerClosesZeroRemainingStatementWithoutCreatingRegularPayment() {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(fixture, 20_000, "zero-due-purchase");
        UUID statementId = statementId(purchase.transactionId());
        prepay(fixture, statementId, 20_000, "zero-due-prepayment");
        jdbcTemplate.update("""
                update card_statement
                   set status = 'OPEN', finalized_at = null, settled_at = null,
                       version = version + 1
                 where id = ?
                """, statementId);
        jdbcTemplate.update("""
                update card_payment_schedule
                   set status = 'SCHEDULED', scheduled_on = date '2026-08-25'
                 where statement_id = ?
                """, statementId);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));

        CardSettlementWorker.SettlementRunResult result = worker.runDueSettlements();

        assertThat(result.completedWithoutPayment()).isOne();
        assertThat(statements.statement(fixture.userId(), statementId).status()).isEqualTo("PAID");
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'REGULAR'
                """, statementId)).isZero();
        assertThat(scheduleStatus(statementId)).isEqualTo("COMPLETED");
    }

    @Test
    void cardSettingToggleAndAccountChangeSynchronizeOnlyPendingSchedules() {
        Fixture fixture = fixture(false, 200_000);
        TransactionService.TransactionView purchase = purchase(fixture, 80_000, "toggle-purchase");
        UUID statementId = statementId(purchase.transactionId());
        assertThat(scheduleIdOrNull(statementId)).isNull();
        CardStatementService.CardStatementPaymentResult prepayment = prepay(
                fixture, statementId, 10_000, "toggle-prepay");
        assertThat(prepayment.payment().settlementAssetId()).isEqualTo(fixture.bank().assetId());

        AssetService.AssetView enabled = updateCard(
                fixture, fixture.card(), fixture.bank().assetId(), true);
        assertThat(scheduleStatus(statementId)).isEqualTo("SCHEDULED");
        AssetService.AssetView secondBank = createBank(
                fixture, "두 번째 결제 계좌", 50_000, "second-settlement-bank");
        AssetService.AssetView moved = updateCard(
                fixture, enabled, secondBank.assetId(), true);
        assertThat(jdbcTemplate.queryForObject("""
                select settlement_asset_id from card_payment_schedule where statement_id = ?
                """, UUID.class, statementId)).isEqualTo(secondBank.assetId());
        assertThat(jdbcTemplate.queryForObject("""
                select settlement_asset_id from card_statement_payment where id = ?
                """, UUID.class, prepayment.payment().paymentId())).isEqualTo(fixture.bank().assetId());

        updateCard(fixture, moved, secondBank.assetId(), false);
        assertThat(scheduleStatus(statementId)).isEqualTo("CANCELLED");
    }

    @Test
    void workerRecordsTechnicalFailureAndRetriesWithoutDuplicateRegularPayment() {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(fixture, 45_000, "retry-purchase");
        UUID statementId = statementId(purchase.transactionId());
        UUID scheduleId = scheduleId(statementId);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        jdbcTemplate.execute("""
                create function dondok_test_fail_autopay() returns trigger as $$
                begin
                    if new.source_type = 'CARD_AUTOPAY' then
                        raise exception 'forced autopay failure';
                    end if;
                    return new;
                end;
                $$ language plpgsql
                """);
        jdbcTemplate.execute("""
                create trigger dondok_test_fail_autopay_trigger
                before insert on ledger_transaction
                for each row execute function dondok_test_fail_autopay()
                """);

        CardSettlementWorker.SettlementRunResult failed = worker.runDueSettlements();
        assertThat(failed.failed()).isOne();
        assertThat(scheduleStatus(statementId)).isEqualTo("FAILED");
        assertThat(jdbcTemplate.queryForObject("""
                select attempt_count from card_payment_schedule where id = ?
                """, Integer.class, scheduleId)).isOne();
        assertThat(queryLong("select count(*) from card_statement_payment where statement_id = ?", statementId))
                .isZero();

        jdbcTemplate.execute("drop trigger dondok_test_fail_autopay_trigger on ledger_transaction");
        jdbcTemplate.execute("drop function dondok_test_fail_autopay()");
        mutableClock.set(Instant.parse("2026-10-01T00:06:00Z"));
        CardSettlementWorker.SettlementRunResult retried = worker.runDueSettlements();
        assertThat(retried.paid()).isOne();
        assertThat(scheduleStatus(statementId)).isEqualTo("COMPLETED");
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'REGULAR'
                """, statementId)).isOne();
    }

    @Test
    void endedCardCancelsAutomaticScheduleAndRejectsNewPaymentsUntilRestored() {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(
                fixture, 75_000, "archived-card-purchase");
        UUID statementId = statementId(purchase.transactionId());
        UUID scheduleId = scheduleId(statementId);
        AssetService.AssetRemovalPreview removalPreview = assetService.removalPreview(
                fixture.userId(), fixture.card().assetId());

        assertThat(removalPreview.disposition())
                .isEqualTo(AssetService.AssetRemovalDisposition.ARCHIVE);
        assertThat(removalPreview.unpaidCardStatementCount()).isOne();
        assertThat(removalPreview.blockingLinks()).isEmpty();
        assetService.remove(
                fixture.userId(), fixture.card().assetId(),
                removalPreview.expectedVersion(), removalPreview.previewToken());

        AssetService.AssetView endedCard = assetService.asset(
                fixture.userId(), fixture.card().assetId());
        assertThat(endedCard.status()).isEqualTo(AssetService.AssetStatus.ARCHIVED);
        assertThat(endedCard.currentMonthCardPaymentDueWon()
                + endedCard.nextMonthCardPaymentDueWon()).isZero();
        assertThat(scheduleStatus(statementId)).isEqualTo("CANCELLED");

        CardStatementService.CardStatementDetail archivedStatement = statements.statement(
                fixture.userId(), statementId);
        assertThatThrownBy(() -> statements.preview(
                fixture.userId(), statementId,
                new CardStatementService.PrepaymentCommand(
                        75_000, archivedStatement.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_ASSET_INACTIVE"));

        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        assertThat(settlementService.settle(scheduleId))
                .isEqualTo(CardSettlementService.SettlementOutcome.SKIPPED);
        assertThat(queryLong("select count(*) from card_statement_payment where statement_id = ?", statementId))
                .isZero();

        AssetService.AssetView archivedCard = assetService.asset(
                fixture.userId(), fixture.card().assetId());
        assetService.restore(fixture.userId(), fixture.card().assetId(), archivedCard.version());
        assertThat(scheduleStatus(statementId)).isEqualTo("SCHEDULED");
        assertThat(settlementService.settle(scheduleId))
                .isEqualTo(CardSettlementService.SettlementOutcome.PAID);

        assertThat(statements.statement(fixture.userId(), statementId).status()).isEqualTo("PAID");
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-75_000);
    }

    private Object concurrentPrepay(
            Fixture fixture,
            UUID statementId,
            CardStatementService.CardStatementPrepaymentPreview preview,
            String key,
            CountDownLatch ready,
            CountDownLatch start
    ) throws InterruptedException {
        ready.countDown();
        start.await();
        try {
            return statements.prepay(
                    fixture.userId(), statementId, key,
                    new CardStatementService.PrepaymentApplyCommand(
                            preview.amountWon(), preview.statementVersion(), preview.previewToken()));
        } catch (ApiException exception) {
            return exception;
        }
    }

    private CardStatementService.CardStatementPaymentResult prepay(
            Fixture fixture,
            UUID statementId,
            long amountWon,
            String key
    ) {
        CardStatementService.CardStatementDetail detail = statements.statement(
                fixture.userId(), statementId);
        CardStatementService.CardStatementPrepaymentPreview preview = statements.preview(
                fixture.userId(), statementId,
                new CardStatementService.PrepaymentCommand(amountWon, detail.version()));
        return statements.prepay(
                fixture.userId(), statementId, key,
                new CardStatementService.PrepaymentApplyCommand(
                        amountWon, detail.version(), preview.previewToken()));
    }

    private Fixture fixture(boolean autoSettlementEnabled, long bankOpeningBalanceWon) {
        mutableClock.set(PREPAYMENT_NOW);
        UUID userId = createUser("카드 정산 작성자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(userId);
        UUID memberId = book.members().stream()
                .filter(MembershipService.LedgerMemberView::currentUser)
                .findFirst().orElseThrow().memberId();
        Fixture bare = new Fixture(
                userId, book.ledgerId(), memberId, null, null,
                category(userId, CategoryKind.EXPENSE, "FOOD"));
        AssetService.AssetView bank = createBank(
                bare, "정산 계좌", bankOpeningBalanceWon, "settlement-bank-" + userId);
        AssetService.AssetView card = assetService.create(
                userId, "settlement-card-" + userId,
                new AssetService.AssetCommand(
                        assetType(userId, "CREDIT_CARD"), AssetOwnershipScope.PERSONAL,
                        memberId, "정산 카드", LocalDate.of(2026, 7, 1), null, 0,
                        new AssetService.CardSettingsCommand(
                                14, 25, 1, bank.assetId(), autoSettlementEnabled)));
        return new Fixture(
                userId, book.ledgerId(), memberId, bank, card, bare.expenseCategoryId());
    }

    private AssetService.AssetView createBank(
            Fixture fixture,
            String name,
            long openingBalanceWon,
            String key
    ) {
        return assetService.create(
                fixture.userId(), key,
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), name, LocalDate.of(2026, 7, 1), null,
                        openingBalanceWon, null));
    }

    private AssetService.AssetView updateCard(
            Fixture fixture,
            AssetService.AssetView card,
            UUID settlementAssetId,
            boolean autoSettlementEnabled
    ) {
        return assetService.update(
                fixture.userId(), card.assetId(),
                new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                card.assetTypeId(), card.ownershipScope(), card.ownerMemberId(),
                                card.name(), card.openedOn(), card.memo(), card.openingBalanceWon(),
                                new AssetService.CardSettingsCommand(
                                        card.cardSettings().statementClosingDay(),
                                        card.cardSettings().paymentDay(),
                                        card.cardSettings().paymentMonthOffset(),
                                        settlementAssetId, autoSettlementEnabled)),
                        card.version(), false));
    }

    private TransactionService.TransactionView purchase(Fixture fixture, long amountWon, String key) {
        return transactionService.create(
                fixture.userId(), key,
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), amountWon, fixture.expenseCategoryId(),
                        fixture.card().assetId(), fixture.memberId(), key, 1));
    }

    private UUID statementId(UUID purchaseId) {
        return jdbcTemplate.queryForObject("""
                select statement_id from card_charge where source_transaction_id = ?
                """, UUID.class, purchaseId);
    }

    private UUID scheduleId(UUID statementId) {
        return jdbcTemplate.queryForObject(
                "select id from card_payment_schedule where statement_id = ?",
                UUID.class, statementId);
    }

    private UUID scheduleIdOrNull(UUID statementId) {
        List<UUID> ids = jdbcTemplate.queryForList(
                "select id from card_payment_schedule where statement_id = ?",
                UUID.class, statementId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private String scheduleStatus(UUID statementId) {
        return jdbcTemplate.queryForObject(
                "select status from card_payment_schedule where statement_id = ?",
                String.class, statementId);
    }

    private long balance(UUID assetId) {
        return queryLong("select current_balance_won from asset_current_balance where asset_id = ?", assetId);
    }

    private long queryLong(String sql, UUID id) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class, id);
        return value == null ? 0 : value;
    }

    private UUID assetType(UUID userId, String systemCode) {
        return assetService.assetTypes(userId).stream()
                .filter(type -> systemCode.equals(type.systemCode()))
                .findFirst().orElseThrow().assetTypeId();
    }

    private UUID category(UUID userId, CategoryKind kind, String systemCode) {
        return categoryService.categories(userId, kind).stream()
                .filter(category -> systemCode.equals(category.systemCode()))
                .findFirst().orElseThrow().categoryId();
    }

    private UUID createUser(String displayName) {
        UUID userId = UUID.randomUUID();
        users.add(userId);
        Timestamp now = Timestamp.from(PREPAYMENT_NOW);
        jdbcTemplate.update("""
                insert into app_user (
                    id, display_name, email, status, email_verified_at,
                    locale, time_zone, created_at, updated_at, version
                ) values (?, ?, ?, 'ACTIVE', ?, 'ko-KR', 'Asia/Seoul', ?, ?, 0)
                """, userId, displayName, userId + "@card-settlement.test", now, now, now);
        return userId;
    }

    private record Fixture(
            UUID userId,
            UUID bookId,
            UUID memberId,
            AssetService.AssetView bank,
            AssetService.AssetView card,
            UUID expenseCategoryId
    ) {
    }

    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> instant;

        MutableClock(Instant initial) {
            this.instant = new AtomicReference<>(initial);
        }

        void set(Instant value) {
            instant.set(value);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant.get();
        }
    }

    @TestConfiguration
    static class MutableClockConfiguration {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock(PREPAYMENT_NOW);
        }
    }
}
