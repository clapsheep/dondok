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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 35})
    void manualFullPaymentWorksBeforeOnAndAfterDueDateWithoutAutopay(int daysFromDue) {
        Fixture fixture = fixture(false, 0);
        UUID ownerUser = createUser("수동 결제 카드 명의자");
        UUID ownerMember = UUID.randomUUID();
        jdbcTemplate.update("insert into ledger_member (id, book_id, user_id) values (?, ?, ?)",
                ownerMember, fixture.bookId(), ownerUser);
        jdbcTemplate.update("update asset set owner_member_id = ? where id in (?, ?)", ownerMember, fixture.card().assetId(), fixture.bank().assetId());
        UUID statementId = statementId(purchase(fixture, 120_000, "manual-purchase").transactionId());
        prepay(fixture, statementId, 30_000, "manual-prior-prepay");
        var initial = statements.statement(fixture.userId(), statementId);
        LocalDate today = initial.dueOn().plusDays(daysFromDue);
        mutableClock.set(today.atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant());
        var command = new CardStatementService.ManualPaymentCommand(initial.version(), 90_000, fixture.bank().assetId());
        var paid = statements.payManually(fixture.userId(), statementId, "manual-full", command);
        var replay = statements.payManually(fixture.userId(), statementId, "manual-full", command);
        assertThat(replay.payment().paymentId()).isEqualTo(paid.payment().paymentId());
        assertThat(paid.payment().paymentType()).isEqualTo("MANUAL");
        assertThat(paid.payment().paidOn()).isEqualTo(today);
        assertThat(paid.settlementTransaction().performedBy().memberId()).isEqualTo(ownerMember);
        assertThat(paid.settlementTransaction().createdBy().memberId()).isEqualTo(fixture.memberId());
        assertThat(paid.statement().status()).isEqualTo("PAID");
        assertThat(paid.statement().remainingAmountWon()).isZero();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-120_000);
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(statements.statements(fixture.userId(), fixture.card().assetId(), null, 20, false).items()).isEmpty();
        var calendar = transactionService.calendar(fixture.userId(), java.time.YearMonth.from(today), ownerMember);
        assertThat(calendar.totalExpenseWon()).isZero();
        assertThat(calendar.days()).anySatisfy(day -> {
            assertThat(day.date()).isEqualTo(today);
            assertThat(day.cardPaymentWon()).isEqualTo(90_000);
            assertThat(day.transactionCount()).isEqualTo(1);
        });
        assertThatThrownBy(() -> statements.payManually(fixture.userId(), statementId, "different-key", command))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getStatus().value()).isEqualTo(412));
        var cancelled = statements.cancelPayment(fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.statement().version()));
        assertThat(cancelled.statement().remainingAmountWon()).isEqualTo(90_000);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-30_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-90_000);
    }

    @Test
    void manualPaymentUsesSelectedDateForPaymentPostingsAndCalendar() {
        Fixture fixture = fixture(false, 200_000);
        UUID statementId = statementId(purchase(fixture, 80_000, "dated-purchase").transactionId());
        var initial = statements.statement(fixture.userId(), statementId);
        LocalDate paidOn = LocalDate.of(2026, 8, 25);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        var command = new CardStatementService.ManualPaymentCommand(initial.version(), 80_000, fixture.bank().assetId(), paidOn);
        var paid = statements.payManually(fixture.userId(), statementId, "dated-payment", command);
        assertThat(paid.payment().paidOn()).isEqualTo(paidOn);
        assertThat(paid.settlementTransaction().occurredOn()).isEqualTo(paidOn);
        assertThat(jdbcTemplate.queryForObject("select occurred_on from ledger_transaction where id = ?",
                LocalDate.class, paid.settlementTransaction().transactionId())).isEqualTo(paidOn);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(120_000);
        assertThat(balance(fixture.card().assetId())).isZero();
        var calendar = transactionService.calendar(fixture.userId(), java.time.YearMonth.from(paidOn), fixture.memberId());
        assertThat(calendar.totalExpenseWon()).isZero();
        assertThat(calendar.totalIncomeWon()).isZero();
        assertThat(calendar.days()).anySatisfy(day -> {
            assertThat(day.date()).isEqualTo(paidOn);
            assertThat(day.cardPaymentWon()).isEqualTo(80_000);
        });
        assertThat(transactionService.calendar(fixture.userId(), java.time.YearMonth.of(2026, 10), fixture.memberId()).days())
                .allSatisfy(day -> assertThat(day.cardPaymentWon()).isZero());
        mutableClock.set(Instant.parse("2026-10-02T00:00:00Z"));
        assertThat(statements.payManually(fixture.userId(), statementId, "dated-payment", command).payment())
                .isEqualTo(paid.payment());
        assertThatThrownBy(() -> statements.payManually(fixture.userId(), statementId, "dated-payment",
                new CardStatementService.ManualPaymentCommand(initial.version(), 80_000, fixture.bank().assetId(), paidOn.plusDays(1))))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getErrorCode()).isEqualTo("IDEMPOTENCY_KEY_REUSED"));
        statements.cancelPayment(fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.statement().version()));
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-80_000);
        assertThat(transactionService.calendar(fixture.userId(), java.time.YearMonth.from(paidOn), fixture.memberId()).days())
                .allSatisfy(day -> assertThat(day.cardPaymentWon()).isZero());
    }

    @Test
    void backdatedManualPaymentBeforeAccountAnchorDoesNotDebitBalanceAgain() {
        Fixture fixture = fixture(false, 200_000);
        UUID statementId = statementId(purchase(fixture, 80_000, "anchor-dated-purchase").transactionId());
        jdbcTemplate.update("update asset set opened_on = ? where id = ?",
                LocalDate.of(2026, 9, 1), fixture.bank().assetId());
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        var initial = statements.statement(fixture.userId(), statementId);
        var paid = statements.payManually(fixture.userId(), statementId, "anchor-dated-payment",
                new CardStatementService.ManualPaymentCommand(initial.version(), 80_000,
                        fixture.bank().assetId(), LocalDate.of(2026, 8, 25)));
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(paid.statement().remainingAmountWon()).isZero();
        assertThat(paid.settlementTransaction().postings()).anySatisfy(posting -> {
            assertThat(posting.assetId()).isEqualTo(fixture.bank().assetId());
            assertThat(posting.deltaWon()).isEqualTo(-80_000);
        });
        statements.cancelPayment(fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.statement().version()));
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-80_000);
    }

    @Test
    void manualPaymentRejectsChangedAccountAndAnotherLedger() {
        Fixture fixture = fixture(false, 0);
        UUID statementId = statementId(purchase(fixture, 40_000, "manual-stale").transactionId());
        var initial = statements.statement(fixture.userId(), statementId);
        var command = new CardStatementService.ManualPaymentCommand(initial.version(), 40_000, fixture.bank().assetId());
        var otherAccount = createBank(fixture, "새 출금 계좌", 0, "manual-other-bank");
        updateCard(fixture, fixture.card(), otherAccount.assetId(), false);
        assertThatThrownBy(() -> statements.payManually(fixture.userId(), statementId, "manual-stale", command))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
        Fixture outsider = fixture(false, 0);
        assertThatThrownBy(() -> statements.payManually(outsider.userId(), statementId, "manual-outsider", command))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getErrorCode()).isEqualTo("CARD_STATEMENT_NOT_FOUND"));
        assertThat(queryLong("select count(*) from card_statement_payment where statement_id = ?", statementId)).isZero();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void concurrentManualAndManualOrWorkerPayOnlyOnce(boolean raceWorker) throws Exception {
        Fixture fixture = fixture(true, 0);
        UUID statementId = statementId(purchase(fixture, 80_000, "manual-race").transactionId());
        var initial = statements.statement(fixture.userId(), statementId);
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        var command = new CardStatementService.ManualPaymentCommand(initial.version(), 80_000, fixture.bank().assetId());
        UUID schedule = UUID.randomUUID();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Object> first = executor.submit(() -> {
                ready.countDown(); start.await();
                try { return statements.payManually(fixture.userId(), statementId, "manual-race-a", command); }
                catch (ApiException error) { return error; }
            });
            Future<Object> second = executor.submit(() -> {
                ready.countDown(); start.await();
                try { return raceWorker ? settlementService.settle(schedule)
                        : statements.payManually(fixture.userId(), statementId, "manual-race-b", command); }
                catch (ApiException error) { return error; }
            });
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            Object firstResult = first.get(10, TimeUnit.SECONDS);
            Object secondResult = second.get(10, TimeUnit.SECONDS);
            for (Object result : List.of(firstResult, secondResult)) {
                if (result instanceof ApiException error) assertThat(error.getErrorCode()).isEqualTo("VERSION_CONFLICT");
            }
        } finally { executor.shutdownNow(); }
        var paid = statements.statement(fixture.userId(), statementId);
        assertThat(paid.payments()).hasSize(1);
        assertThat(paid.remainingAmountWon()).isZero();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-80_000);
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(settlementService.settle(schedule)).isEqualTo(CardSettlementService.SettlementOutcome.SKIPPED);
        if (paid.payments().get(0).paymentType().equals("MANUAL")) {
            statements.cancelPayment(fixture.userId(), statementId, paid.payments().get(0).paymentId(),
                    new CardStatementService.CancelPaymentCommand(paid.version()));
            assertThat(scheduleIdOrNull(statementId)).isNull();
            assertThat(settlementService.settle(schedule)).isEqualTo(CardSettlementService.SettlementOutcome.SKIPPED);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"REGULAR", "MANUAL", "PREPAYMENT"})
    void latePurchaseAfterFullPaymentRemainsUnpaidUntilManualPayment(String paymentType) {
        Fixture fixture = fixture(true, 0);
        UUID statementId = statementId(purchase(fixture, 100_000, "late-original").transactionId());
        if (paymentType.equals("PREPAYMENT")) prepay(fixture, statementId, 100_000, "late-prepay");
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        if (paymentType.equals("REGULAR")) recordHistoricalRegular(fixture, statementId);
        if (paymentType.equals("MANUAL")) {
            var initial = statements.statement(fixture.userId(), statementId);
            statements.payManually(fixture.userId(), statementId, "late-manual-original",
                    new CardStatementService.ManualPaymentCommand(initial.version(), 100_000, fixture.bank().assetId()));
        }
        var original = statements.statement(fixture.userId(), statementId).payments().get(0);
        purchase(fixture, 20_000, "late-added");
        worker.runDueSettlements();
        var reopened = statements.statement(fixture.userId(), statementId);
        assertThat(reopened.status()).isEqualTo("FINALIZED");
        assertThat(reopened.remainingAmountWon()).isEqualTo(20_000);
        assertThat(reopened.additionalUsageAfterPayment()).isTrue();
        assertThat(reopened.payments()).containsExactly(original);
        assertThat(statements.statements(fixture.userId(), fixture.card().assetId(), null, 20, false).items()).hasSize(1);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-100_000);
        AssetService.AssetView disabled = updateCard(fixture, fixture.card(), fixture.bank().assetId(), false);
        updateCard(fixture, disabled, fixture.bank().assetId(), true);
        worker.runDueSettlements();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-100_000);
        reopened = statements.statement(fixture.userId(), statementId);
        var paid = statements.payManually(fixture.userId(), statementId, "late-manual-residual",
                new CardStatementService.ManualPaymentCommand(reopened.version(), 20_000, fixture.bank().assetId()));
        assertThat(paid.statement().status()).isEqualTo("PAID");
        assertThat(paid.statement().remainingAmountWon()).isZero();
        assertThat(paid.statement().payments()).hasSize(2).contains(original);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-120_000);
        assertThat(balance(fixture.card().assetId())).isZero();
    }

    @Test
    void newUsageBeforeDueDateRemainsUnpaidWithoutScheduling() {
        Fixture fixture = fixture(true, 0);
        UUID statementId = statementId(purchase(fixture, 100_000, "early-original").transactionId());
        prepay(fixture, statementId, 100_000, "early-prepay");
        purchase(fixture, 20_000, "early-added");
        var reopened = statements.statement(fixture.userId(), statementId);
        assertThat(reopened.status()).isEqualTo("OPEN");
        assertThat(reopened.additionalUsageAfterPayment()).isFalse();
        assertThat(reopened.remainingAmountWon()).isEqualTo(20_000);
        assertThat(scheduleIdOrNull(statementId)).isNull();
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        worker.runDueSettlements();
        assertThat(statements.statement(fixture.userId(), statementId).remainingAmountWon()).isEqualTo(20_000);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-100_000);
    }

    @Test
    void cardAndAccountOwnerReceivesPaymentHistoryIndependentlyOfWriter() {
        Fixture fixture = fixture(true, 0);
        UUID otherUser = createUser("카드 명의자");
        UUID cardOwner = UUID.randomUUID();
        jdbcTemplate.update("insert into ledger_member (id, book_id, user_id) values (?, ?, ?)",
                cardOwner, fixture.bookId(), otherUser);
        jdbcTemplate.update("update asset set owner_member_id = ? where id in (?, ?)", cardOwner, fixture.card().assetId(), fixture.bank().assetId());
        UUID statementId = statementId(purchase(fixture, 120_000, "owner-purchase").transactionId());
        var prepayment = prepay(fixture, statementId, 30_000, "owner-prepay");
        var replay = statements.statement(fixture.userId(), statementId);
        assertThat(prepayment.settlementTransaction().performedBy().memberId()).isEqualTo(cardOwner);
        assertThat(prepayment.settlementTransaction().createdBy().memberId()).isEqualTo(fixture.memberId());
        assertThat(replay.payments()).hasSize(1);
        var july = transactionService.calendar(fixture.userId(), java.time.YearMonth.of(2026, 7), cardOwner);
        assertThat(july.totalIncomeWon()).isZero();
        assertThat(july.totalExpenseWon()).isZero();
        assertThat(july.days()).singleElement().satisfies(day -> {
            assertThat(day.date()).isEqualTo(LocalDate.of(2026, 7, 18));
            assertThat(day.cardPaymentWon()).isEqualTo(30_000);
        });
        assertThat(transactionService.transactions(fixture.userId(), LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1), null, 30, cardOwner).items())
                .extracting(TransactionService.TransactionView::transactionId)
                .containsExactly(prepayment.settlementTransaction().transactionId());
        assertThat(transactionService.calendar(fixture.userId(), java.time.YearMonth.of(2026, 7), fixture.memberId())
                .days()).allMatch(day -> day.cardPaymentWon() == 0);

        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        recordHistoricalRegular(fixture, statementId);
        var regular = statements.statement(fixture.userId(), statementId).payments().stream()
                .filter(payment -> payment.paymentType().equals("REGULAR")).findFirst().orElseThrow();
        var transaction = transactionService.transaction(fixture.userId(), regular.settlementTransactionId());
        assertThat(transaction.performedBy().memberId()).isEqualTo(cardOwner);
        assertThat(transaction.createdBy()).isNull();
        var august = transactionService.calendar(fixture.userId(), java.time.YearMonth.from(transaction.occurredOn()), cardOwner);
        assertThat(august.days()).singleElement().satisfies(day -> assertThat(day.cardPaymentWon()).isEqualTo(90_000));
        assertThat(august.totalExpenseWon()).isZero();
        assertThat(august.totalIncomeWon()).isZero();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-120_000);
        assertThat(balance(fixture.card().assetId())).isZero();

        // Subsequent ownership changes never rewrite the recorded payment participant.
        jdbcTemplate.update("update asset set owner_member_id = ? where id = ?", fixture.memberId(), fixture.card().assetId());
        assertThat(transactionService.transaction(fixture.userId(), transaction.transactionId()).performedBy().memberId()).isEqualTo(cardOwner);
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
            assertThat(item.automaticSettlement()).isNull();
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
        assertThat(second.settlementTransaction().performedBy().memberId()).isEqualTo(fixture.memberId());
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
        assertThat(scheduleIdOrNull(statementId)).isNull();

        TransactionService.TransactionView transactionDetail = transactionService.transaction(
                fixture.userId(), paid.settlementTransaction().transactionId());
        assertThat(transactionDetail.cardPayment()).satisfies(reference -> {
            assertThat(reference.statementId()).isEqualTo(statementId);
            assertThat(reference.paymentId()).isEqualTo(paid.payment().paymentId());
            assertThat(reference.paymentType()).isEqualTo("PREPAYMENT");
            assertThat(reference.statementVersion()).isEqualTo(paid.statement().version());
            assertThat(reference.returnedAmountWon()).isZero();
        });

        CardStatementService.CardPaymentCancellationResult cancelled = statements.cancelPayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.statement().version()));

        assertThat(cancelled.statement().status()).isEqualTo("OPEN");
        assertThat(transactionService.calendar(fixture.userId(), java.time.YearMonth.of(2026, 7), fixture.memberId())
                .days()).allMatch(day -> day.cardPaymentWon() == 0);

        assertThat(cancelled.statement().remainingAmountWon()).isEqualTo(100_000);
        assertThat(cancelled.statement().payments()).isEmpty();
        assertThat(cancelled.cancelledPaymentId()).isEqualTo(paid.payment().paymentId());
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-100_000);
        assertThat(scheduleIdOrNull(statementId)).isNull();
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

        assertThatThrownBy(() -> statements.cancelPayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.statement().version() - 1)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));

        CardStatementService.CardPaymentCancellationResult cancelled = statements.cancelPayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.statement().version()));
        assertThatThrownBy(() -> statements.cancelPayment(
                fixture.userId(), statementId, paid.payment().paymentId(),
                new CardStatementService.CancelPaymentCommand(cancelled.statement().version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_PAYMENT_ALREADY_CANCELLED"));
    }

    @Test
    void cancellingAutomaticSettlementRestoresBalancesAndDoesNotRunAgain() {
        Fixture fixture = fixture(true, 200_000);
        UUID statementId = statementId(purchase(
                fixture, 100_000, "cancel-automatic-settlement-purchase").transactionId());
        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        recordHistoricalRegular(fixture, statementId);

        CardStatementService.CardStatementDetail paid = statements.statement(
                fixture.userId(), statementId);
        CardStatementService.CardStatementPayment regularPayment = paid.payments().stream()
                .filter(payment -> "REGULAR".equals(payment.paymentType()))
                .findFirst()
                .orElseThrow();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(100_000);
        assertThat(balance(fixture.card().assetId())).isZero();

        CardStatementService.CardPaymentCancellationResult cancelled = statements.cancelPayment(
                fixture.userId(), statementId, regularPayment.paymentId(),
                new CardStatementService.CancelPaymentCommand(paid.version()));

        assertThat(cancelled.statement().status()).isEqualTo("FINALIZED");
        assertThat(cancelled.statement().remainingAmountWon()).isEqualTo(100_000);
        assertThat(cancelled.statement().payments()).isEmpty();
        assertThat(cancelled.cancelledPaymentId()).isEqualTo(regularPayment.paymentId());
        assertThat(balance(fixture.bank().assetId())).isEqualTo(200_000);
        assertThat(balance(fixture.card().assetId())).isEqualTo(-100_000);
        assertThat(scheduleStatus(statementId)).isEqualTo("CANCELLED");
        assertThat(queryLong("""
                select count(*) from ledger_transaction
                 where id = ? and deleted_at is not null
                """, regularPayment.settlementTransactionId())).isOne();
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where id = ? and cancelled_at is not null
                """, regularPayment.paymentId())).isOne();

        CardSettlementWorker.SettlementRunResult rerun = worker.runDueSettlements();
        assertThat(rerun.paid()).isZero();
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'REGULAR' and cancelled_at is null
                """, statementId)).isZero();
    }

    @Test
    void savingPaidOpeningBalanceCardPreservesSettlementAndDoesNotPayAgain() {
        Fixture fixture = fixture(true, 200_000);
        AssetService.AssetView cardWithOpeningBalance = assetService.update(
                fixture.userId(), fixture.card().assetId(),
                new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                fixture.card().assetTypeId(), fixture.card().ownershipScope(),
                                fixture.card().ownerMemberId(), fixture.card().name(),
                                fixture.card().openedOn(), fixture.card().memo(), -100_000,
                                new AssetService.CardSettingsCommand(
                                        fixture.card().cardSettings().statementClosingDay(),
                                        fixture.card().cardSettings().paymentDay(),
                                        fixture.card().cardSettings().paymentMonthOffset(),
                                        fixture.bank().assetId(), true)),
                        fixture.card().version(), false));
        UUID statementId = jdbcTemplate.queryForObject("""
                select statement_id from card_charge
                 where card_asset_id = ? and charge_origin = 'OPENING_BALANCE'
                """, UUID.class, fixture.card().assetId());


        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        recordHistoricalRegular(fixture, statementId);
        UUID scheduleId = scheduleId(statementId);
        assertThat(balance(fixture.bank().assetId())).isEqualTo(100_000);
        assertThat(balance(fixture.card().assetId())).isZero();

        AssetService.AssetView savedAgain = assetService.update(
                fixture.userId(), cardWithOpeningBalance.assetId(),
                new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                cardWithOpeningBalance.assetTypeId(),
                                cardWithOpeningBalance.ownershipScope(),
                                cardWithOpeningBalance.ownerMemberId(),
                                cardWithOpeningBalance.name(), cardWithOpeningBalance.openedOn(),
                                cardWithOpeningBalance.memo(),
                                cardWithOpeningBalance.openingBalanceWon(),
                                new AssetService.CardSettingsCommand(
                                        cardWithOpeningBalance.cardSettings().statementClosingDay(),
                                        cardWithOpeningBalance.cardSettings().paymentDay(),
                                        cardWithOpeningBalance.cardSettings().paymentMonthOffset(),
                                        fixture.bank().assetId(), true)),
                        cardWithOpeningBalance.version(), false));

        assertThat(savedAgain.openingBalanceWon()).isEqualTo(-100_000);
        assertThat(queryLong("select count(*) from card_statement where id = ?", statementId)).isOne();
        assertThat(queryLong("""
                select count(*) from card_statement_payment
                 where statement_id = ? and payment_type = 'REGULAR'
                """, statementId)).isOne();
        assertThat(scheduleId(statementId)).isEqualTo(scheduleId);
        assertThat(scheduleStatus(statementId)).isEqualTo("COMPLETED");
        assertThat(statements.statement(fixture.userId(), statementId).remainingAmountWon()).isZero();
        assertThat(worker.runDueSettlements().paid()).isZero();
        assertThat(queryLong("""
                select count(*) from ledger_transaction
                 where book_id = ? and source_type = 'CARD_AUTOPAY' and deleted_at is null
                """, fixture.bookId())).isOne();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(100_000);
        assertThat(balance(fixture.card().assetId())).isZero();
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

        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        recordHistoricalRegular(fixture, statementId);
        UUID scheduleId = scheduleId(statementId);
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

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void fullPrepaymentCorrectionIncreaseNeverSchedules(boolean pastDue) {
        Fixture fixture = fixture(true, 100_000);
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "full-purchase");
        UUID statementId = statementId(purchase.transactionId());
        CardStatementService.CardStatementPaymentResult fullyPaid = prepay(
                fixture, statementId, 100_000, "full-prepayment");
        assertThat(fullyPaid.statement().status()).isEqualTo("PAID");
        assertThat(scheduleIdOrNull(statementId)).isNull();
        if (pastDue) mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));

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
        assertThat(reopened.status()).isEqualTo(pastDue ? "FINALIZED" : "OPEN");
        assertThat(reopened.remainingAmountWon()).isEqualTo(50_000);
        assertThat(reopened.additionalUsageAfterPayment()).isEqualTo(pastDue);
        assertThat(reopened.automaticSettlement()).isNull();
        if (pastDue) {
            worker.runDueSettlements();
            assertThat(balance(fixture.bank().assetId())).isZero();
        }
    }

    @Test
    void endedCardCancelsAutomaticScheduleAndRejectsNewPaymentsUntilRestored() {
        Fixture fixture = fixture(true, 0);
        TransactionService.TransactionView purchase = purchase(
                fixture, 75_000, "archived-card-purchase");
        UUID statementId = statementId(purchase.transactionId());
        UUID scheduleId = UUID.randomUUID();
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
        assertThat(scheduleIdOrNull(statementId)).isNull();

        CardStatementService.CardStatementDetail archivedStatement = statements.statement(
                fixture.userId(), statementId);
        assertThatThrownBy(() -> statements.preview(
                fixture.userId(), statementId,
                new CardStatementService.PrepaymentCommand(
                        75_000, archivedStatement.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_ASSET_INACTIVE"));

        assertThatThrownBy(() -> statements.payManually(fixture.userId(), statementId, "archived-manual",
                new CardStatementService.ManualPaymentCommand(archivedStatement.version(), 75_000, fixture.bank().assetId())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("CARD_ASSET_INACTIVE"));

        mutableClock.set(Instant.parse("2026-10-01T00:00:00Z"));
        assertThat(settlementService.settle(scheduleId))
                .isEqualTo(CardSettlementService.SettlementOutcome.SKIPPED);
        assertThat(queryLong("select count(*) from card_statement_payment where statement_id = ?", statementId))
                .isZero();

        AssetService.AssetView archivedCard = assetService.asset(
                fixture.userId(), fixture.card().assetId());
        assetService.restore(fixture.userId(), fixture.card().assetId(), archivedCard.version());
        assertThat(scheduleIdOrNull(statementId)).isNull();
        var current = statements.statement(fixture.userId(), statementId);
        statements.payManually(fixture.userId(), statementId, "restored-manual", new CardStatementService.ManualPaymentCommand(current.version(), current.remainingAmountWon(), fixture.bank().assetId()));

        assertThat(statements.statement(fixture.userId(), statementId).status()).isEqualTo("PAID");
        assertThat(balance(fixture.card().assetId())).isZero();
        assertThat(balance(fixture.bank().assetId())).isEqualTo(-75_000);
    }

    /** Seed a payment made by the retired version, without re-enabling execution. */
    private void recordHistoricalRegular(Fixture fixture, UUID statementId) {
        var current = statements.statement(fixture.userId(), statementId);
        var paid = statements.payManually(fixture.userId(), statementId, "historical-" + statementId,
                new CardStatementService.ManualPaymentCommand(current.version(), current.remainingAmountWon(), fixture.bank().assetId(), current.dueOn()));
        UUID schedule = UUID.randomUUID();
        jdbcTemplate.update("insert into card_payment_schedule(id, book_id, statement_id, settlement_asset_id, scheduled_on, status) values (?, ?, ?, ?, ?, 'COMPLETED')",
                schedule, fixture.bookId(), statementId, fixture.bank().assetId(), java.sql.Date.valueOf(current.dueOn()));
        jdbcTemplate.update("update card_statement_payment set payment_type = 'REGULAR', created_by_member_id = null where id = ?", paid.payment().paymentId());
        jdbcTemplate.update("update ledger_transaction set source_type = 'CARD_AUTOPAY', source_id = ?, created_by_member_id = null, updated_by_member_id = null where id = ?", schedule, paid.settlementTransaction().transactionId());
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
