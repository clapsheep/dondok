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
@Import(CardPaymentItemIntegrationTest.MutableClockConfiguration.class)
class CardPaymentItemIntegrationTest {
    private static final Instant PREPAYMENT_NOW = Instant.parse("2026-07-18T03:00:00Z");

    @Autowired private CardStatementService statements;
    @Autowired private CardPaymentItemService itemPayments;
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
        for (UUID userId : users) {
            jdbcTemplate.update("delete from ledger_book where created_by_user_id = ?", userId);
        }
        for (UUID userId : users) {
            jdbcTemplate.update("delete from app_user where id = ?", userId);
        }
        mutableClock.set(PREPAYMENT_NOW);
    }

    @Test
    void closedDefaultIsIndependentOfPaymentDayAndFutureInstallmentsAreUnchecked() {
        Fixture f = fixture(false, 0);
        var purchase = transactionService.create(f.userId(), "installments", new TransactionService.CreateExpense(
                LocalDate.of(2026, 7, 10), 90_000, f.expenseCategoryId(), f.card().assetId(), f.memberId(), "할부", 3));
        mutableClock.set(Instant.parse("2026-07-24T00:00:00Z"));
        var before = itemPayments.list(f.userId(), f.card().assetId(), null, 1);
        assertThat(before.items()).hasSize(1);
        assertThat(before.nextCursor()).isNotNull();
        assertThat(before.recentClosingOn()).isEqualTo(LocalDate.of(2026, 7, 14));
        assertThat(before.totals().amountWon()).isEqualTo(90_000);
        assertThat(before.totals().closedAmountWon()).isEqualTo(30_000);
        mutableClock.set(Instant.parse("2026-07-30T00:00:00Z"));
        assertThat(itemPayments.list(f.userId(), f.card().assetId(), null, 1).totals()).isEqualTo(before.totals());
        var next = itemPayments.list(f.userId(), f.card().assetId(), before.nextCursor(), 1);
        assertThat(next.items().get(0).installmentNo()).isEqualTo(2);
        assertThat(next.items().get(0).sourceTransactionId()).isEqualTo(purchase.transactionId());
        var paid = itemPayments.pay(f.userId(), f.card().assetId(), "closed-all", command(before, f.bank().assetId(), "SELECTED", "CLOSED", null, List.of(), List.of()));
        assertThat(paid.amountWon()).isEqualTo(30_000);
        var future = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        var futureCharge = future.items().get(1);
        assertThat(itemPayments.pay(f.userId(), f.card().assetId(), "future", command(future, f.bank().assetId(), "SELECTED", "NONE", null, List.of(futureCharge.chargeId()), List.of())).amountWon()).isEqualTo(30_000);
        assertThat(itemPayments.list(f.userId(), f.card().assetId(), null, 30).items()).singleElement().satisfies(item -> assertThat(item.installmentNo()).isEqualTo(2));
    }

    @Test
    void selectedItemAccountDateIdempotencyAndCancellationStayConsistent() {
        Fixture f = fixture(false, 0);
        var first = purchase(f, 30_000, "first");
        var second = purchase(f, 50_000, "second");
        var otherBank = createBank(f, "다른 출금 계좌", 0, "other-bank");
        mutableClock.set(Instant.parse("2026-10-12T00:00:00Z"));
        var page = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        UUID selected = page.items().stream().filter(row -> row.sourceTransactionId().equals(second.transactionId())).findFirst().orElseThrow().chargeId();
        var cmd = command(page, otherBank.assetId(), "SELECTED", "NONE", null, List.of(selected), List.of());
        var paid = itemPayments.pay(f.userId(), f.card().assetId(), "selection", cmd);
        assertThat(itemPayments.pay(f.userId(), f.card().assetId(), "selection", cmd)).isEqualTo(paid);
        assertThat(balance(otherBank.assetId())).isEqualTo(-50_000);
        assertThat(balance(f.bank().assetId())).isZero();
        assertThat(itemPayments.list(f.userId(), f.card().assetId(), null, 30).items()).singleElement()
            .satisfies(item -> assertThat(item.sourceTransactionId()).isEqualTo(first.transactionId()));
        var payment = paid.payments().get(0);
        var detail = statements.statement(f.userId(), payment.statementId());
        assertThat(detail.payments().get(0).paidOn()).isEqualTo(LocalDate.of(2026, 9, 13));
        var calendar = transactionService.calendar(f.userId(), java.time.YearMonth.of(2026, 9));
        assertThat(calendar.totalExpenseWon()).isZero();
        assertThat(calendar.days()).singleElement().satisfies(day -> assertThat(day.cardPaymentWon()).isEqualTo(50_000));
        assertThatThrownBy(() -> itemPayments.pay(f.userId(), f.card().assetId(), "new-stale", cmd))
            .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getStatus().value()).isEqualTo(412));
        statements.cancelPayment(f.userId(), payment.statementId(), payment.paymentId(), new CardStatementService.CancelPaymentCommand(detail.version()));
        assertThat(balance(otherBank.assetId())).isZero();
        assertThat(itemPayments.list(f.userId(), f.card().assetId(), null, 30).totals().amountWon()).isEqualTo(80_000);
        assertThatThrownBy(() -> itemPayments.pay(f.userId(), f.card().assetId(), "selection", cmd))
            .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo("CARD_PAYMENT_CANCELLED"));
    }

    @Test
    void partialAmountWorksAfterDueAndAllocatesOldestFirstWithoutStatistics() {
        Fixture f = fixture(true, 0);
        var first = purchase(f, 30_000, "partial-first");
        purchase(f, 50_000, "partial-second");
        mutableClock.set(Instant.parse("2026-10-12T00:00:00Z"));
        var page = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        var paid = itemPayments.pay(f.userId(), f.card().assetId(), "partial", command(page, f.bank().assetId(), "AMOUNT", "NONE", 40_000L, List.of(), List.of()));
        assertThat(paid.amountWon()).isEqualTo(40_000);
        var remaining = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        assertThat(remaining.items()).singleElement().satisfies(item -> {
            assertThat(item.sourceTransactionId()).isNotEqualTo(first.transactionId());
            assertThat(item.remainingAmountWon()).isEqualTo(40_000);
        });
        assertThat(balance(f.bank().assetId())).isEqualTo(-40_000);
        assertThat(balance(f.card().assetId())).isEqualTo(-40_000);
        assertThatThrownBy(() -> itemPayments.pay(f.userId(), f.card().assetId(), "too-much", command(remaining, f.bank().assetId(), "AMOUNT", "ALL", 40_001L, List.of(), List.of())))
            .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getStatus().value()).isEqualTo(409));
        assertThat(f.card().cardSettings().autoSettlementEnabled()).isFalse();
        assertThat(worker.runDueSettlements().paid()).isZero();
        assertThat(queryLong("select count(*) from card_payment_schedule where book_id = ?", f.bookId())).isZero();
    }

    @Test
    void pooledLegacyPaymentAndRefundKeepItemTotalsEqualToStatement() {
        Fixture f = fixture(false, 0);
        var first = purchase(f, 30_000, "legacy-first");
        var second = purchase(f, 50_000, "legacy-second");
        prepay(f, statementId(first.transactionId()), 20_000, "legacy-payment");
        var page = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        assertThat(page.items().get(0).remainingAmountWon()).isEqualTo(10_000);
        var selected = page.items().stream().filter(row -> row.sourceTransactionId().equals(second.transactionId())).findFirst().orElseThrow();
        itemPayments.pay(f.userId(), f.card().assetId(), "selected-after-legacy", command(page, f.bank().assetId(), "SELECTED", "NONE", null, List.of(selected.chargeId()), List.of()));
        var graph = purchaseManagement.management(f.userId(), second.transactionId());
        var preview = purchaseManagement.previewRefund(f.userId(), second.transactionId(), new CardPurchaseManagementService.RefundCommand(LocalDate.of(2026, 9, 14), 50_000, graph.purchase().version(), null));
        assertThat(preview.unpaidCardReductionWon()).isEqualTo(10_000);
        purchaseManagement.refund(f.userId(), second.transactionId(), "refund-selected", new CardPurchaseManagementService.RefundApplyCommand(LocalDate.of(2026, 9, 14), 50_000, graph.purchase().version(), null, preview.previewToken()));
        assertThat(itemPayments.list(f.userId(), f.card().assetId(), null, 30).totals().amountWon()).isZero();
        assertThat(balance(f.card().assetId())).isZero();
        assertThat(balance(f.bank().assetId())).isEqualTo(-30_000);
    }

    @Test
    void defaultSelectionIncludesUnloadedPagesAndOtherLedgerCannotPay() {
        Fixture f = fixture(false, 0);
        for (int i = 0; i < 35; i++) purchase(f, 1_000, "page-" + i);
        mutableClock.set(Instant.parse("2026-10-12T00:00:00Z"));
        var page = itemPayments.list(f.userId(), f.card().assetId(), null, 5);
        assertThat(page.items()).hasSize(5);
        assertThat(page.totals().closedCount()).isEqualTo(35);
        Fixture other = fixture(false, 0);
        mutableClock.set(Instant.parse("2026-10-12T00:00:00Z"));
        var cmd = command(page, f.bank().assetId(), "SELECTED", "CLOSED", null, List.of(), List.of());
        assertThatThrownBy(() -> itemPayments.pay(other.userId(), f.card().assetId(), "foreign", cmd))
            .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getStatus().value()).isEqualTo(404));
        assertThat(itemPayments.pay(f.userId(), f.card().assetId(), "all-pages", cmd).amountWon()).isEqualTo(35_000);
        assertThat(itemPayments.list(f.userId(), f.card().assetId(), null, 5).items()).isEmpty();
    }

    @Test
    void twoMembersSavingSameSnapshotCommitOnePayment() throws Exception {
        Fixture f = fixture(false, 0);
        purchase(f, 50_000, "concurrent");
        UUID otherUser = createUser("다른 구성원");
        jdbcTemplate.update("insert into ledger_member(id, book_id, user_id) values (?, ?, ?)", UUID.randomUUID(), f.bookId(), otherUser);
        var page = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        var cmd = command(page, f.bank().assetId(), "AMOUNT", "ALL", 40_000L, List.of(), List.of());
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (UUID user : List.of(f.userId(), otherUser)) futures.add(executor.submit(() -> {
                start.await();
                try { return itemPayments.pay(user, f.card().assetId(), "race-" + user, cmd); }
                catch (ApiException ex) { return ex; }
            }));
            start.countDown();
            List<Object> results = List.of(futures.get(0).get(10, TimeUnit.SECONDS), futures.get(1).get(10, TimeUnit.SECONDS));
            assertThat(results.stream().filter(CardPaymentItemService.Result.class::isInstance).count()).isEqualTo(1);
            assertThat(results.stream().filter(ApiException.class::isInstance).map(ApiException.class::cast).toList()).singleElement()
                .satisfies(ex -> assertThat(ex.getStatus().value()).isEqualTo(412));
        } finally { executor.shutdownNow(); }
        assertThat(balance(f.bank().assetId())).isEqualTo(-40_000);
    }

    @Test
    void selectedPaymentSurvivesChargeRecreationAfterPurchaseCorrection() {
        Fixture f = fixture(false, 0);
        var first = purchase(f, 30_000, "correction-first");
        var second = purchase(f, 50_000, "correction-selected");
        var page = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        var selected = page.items().stream().filter(item -> item.sourceTransactionId().equals(second.transactionId())).findFirst().orElseThrow();
        itemPayments.pay(f.userId(), f.card().assetId(), "before-correction", command(page, f.bank().assetId(), "SELECTED", "NONE", null, List.of(selected.chargeId()), List.of()));
        var correction = new CardPurchaseManagementService.CorrectionCommand(second.occurredOn(), 70_000,
                f.expenseCategoryId(), f.card().assetId(), f.memberId(), "정정된 구매", 1, second.version());
        var preview = purchaseManagement.previewCorrection(f.userId(), second.transactionId(), correction);
        purchaseManagement.correct(f.userId(), second.transactionId(), "increase-selected",
                new CardPurchaseManagementService.CorrectionApplyCommand(correction.occurredOn(), correction.amountWon(),
                    correction.categoryId(), correction.cardAssetId(), correction.performedByMemberId(),
                    correction.description(), correction.installmentCount(), correction.expectedVersion(), preview.previewToken()));
        var remaining = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        assertThat(remaining.items()).hasSize(2);
        assertThat(remaining.items().stream().filter(item -> item.sourceTransactionId().equals(first.transactionId())).findFirst().orElseThrow().remainingAmountWon()).isEqualTo(30_000);
        assertThat(remaining.items().stream().filter(item -> item.sourceTransactionId().equals(second.transactionId())).findFirst().orElseThrow().remainingAmountWon()).isEqualTo(20_000);
        assertThat(remaining.totals().amountWon()).isEqualTo(50_000);
        assertThat(balance(f.bank().assetId())).isEqualTo(-50_000);
    }

    @Test
    void preAnchorPurchaseRefundReducesOpeningItemWithoutBillingPurchaseAgain() {
        Fixture f = fixture(false, 0);
        var card = assetService.create(f.userId(), "opening-card", new AssetService.AssetCommand(
                assetType(f.userId(), "CREDIT_CARD"), AssetOwnershipScope.PERSONAL, f.memberId(),
                "기준일 카드", LocalDate.of(2026, 7, 1), null, -80_000,
                new AssetService.CardSettingsCommand(14, 25, 1, f.bank().assetId(), false)));
        var purchase = transactionService.create(f.userId(), "absorbed-purchase", new TransactionService.CreateExpense(
                LocalDate.of(2026, 6, 20), 80_000, f.expenseCategoryId(), card.assetId(), f.memberId(), "기준일 이전 구매", 1));
        var before = itemPayments.list(f.userId(), card.assetId(), null, 30);
        assertThat(before.items()).singleElement().satisfies(item -> {
            assertThat(item.origin()).isEqualTo("OPENING_BALANCE");
            assertThat(item.remainingAmountWon()).isEqualTo(80_000);
        });
        var graph = purchaseManagement.management(f.userId(), purchase.transactionId());
        var preview = purchaseManagement.previewRefund(f.userId(), purchase.transactionId(),
                new CardPurchaseManagementService.RefundCommand(LocalDate.of(2026, 7, 20), 30_000, graph.purchase().version(), null));
        purchaseManagement.refund(f.userId(), purchase.transactionId(), "absorbed-refund",
                new CardPurchaseManagementService.RefundApplyCommand(LocalDate.of(2026, 7, 20), 30_000,
                    graph.purchase().version(), null, preview.previewToken()));
        var after = itemPayments.list(f.userId(), card.assetId(), null, 30);
        assertThat(after.totals().amountWon()).isEqualTo(50_000);
        assertThat(after.items()).hasSize(1);
        itemPayments.pay(f.userId(), card.assetId(), "pay-opening", command(after, f.bank().assetId(), "SELECTED", "ALL", null, List.of(), List.of()));
        assertThat(itemPayments.list(f.userId(), card.assetId(), null, 30).items()).isEmpty();
        assertThat(balance(card.assetId())).isZero();
        assertThat(balance(f.bank().assetId())).isEqualTo(-50_000);
    }

    @Test
    void closingChangesAtSeoulMidnight() {
        Fixture f = fixture(false, 0);
        mutableClock.set(Instant.parse("2026-10-13T14:59:59Z"));
        var before = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        assertThat(before.recentClosingOn()).isEqualTo(LocalDate.of(2026, 9, 14));
        mutableClock.set(Instant.parse("2026-10-13T15:00:00Z"));
        var after = itemPayments.list(f.userId(), f.card().assetId(), null, 30);
        assertThat(after.recentClosingOn()).isEqualTo(LocalDate.of(2026, 10, 14));
        assertThat(after.snapshotToken()).isNotEqualTo(before.snapshotToken());
    }

    private CardPaymentItemService.Command command(CardPaymentItemService.Page page, UUID bank, String mode, String base,
            Long amount, List<UUID> include, List<UUID> exclude) {
        return new CardPaymentItemService.Command(page.snapshotToken(), mode, base, include, exclude, amount, bank, LocalDate.of(2026, 9, 13));
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
            return Clock.fixed(instant.get(), zone);
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
