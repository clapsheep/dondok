package com.dondok.statistics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.category.application.CategoryService;
import com.dondok.category.domain.CategoryKind;
import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import com.dondok.statistics.domain.AssetOwnerFilter;
import com.dondok.transaction.application.CardPurchaseManagementService;
import com.dondok.transaction.application.ManagedTransferPort;
import com.dondok.transaction.application.TransactionService;
import com.dondok.transaction.domain.TransferSubtype;
import com.dondok.transaction.domain.TransferPurpose;
import com.dondok.transaction.domain.TransactionType;
import com.dondok.statistics.domain.AssetFormation;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class MonthlyStatisticsServiceIntegrationTest {
    @Autowired private MonthlyStatisticsService statisticsService;
    @Autowired private TransactionService transactionService;
    @Autowired private CardPurchaseManagementService cardManagementService;
    @Autowired private ManagedTransferPort managedTransferPort;
    @Autowired private MembershipService membershipService;
    @Autowired private AssetService assetService;
    @Autowired private CategoryService categoryService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private final List<UUID> users = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        for (UUID userId : users) {
            jdbcTemplate.update("delete from ledger_book where created_by_user_id = ?", userId);
        }
        for (UUID userId : users) {
            jdbcTemplate.update("delete from app_user where id = ?", userId);
        }
    }

    @Test
    void aggregatesOneBoundedMonthAndZeroFillsTheSelectedYearsMonthlyTotals() {
        Fixture fixture = fixture("월간 통계 사용자");
        AssetService.AssetView bank = asset(fixture.userId(), "BANK");
        AssetService.AssetView card = asset(fixture.userId(), "CREDIT_CARD");
        AssetService.AssetView transferDestination = assetService.create(
                fixture.userId(), "statistics-opening-balance",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "시작 금액 계좌", LocalDate.of(2026, 7, 1),
                        null, 123_456, null));
        UUID incomeOther = category(fixture.userId(), CategoryKind.INCOME, "OTHER");
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        transactionService.create(fixture.userId(), "statistics-income",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 7, 10), 500_000, incomeOther, bank.assetId(),
                        fixture.memberId(), "월급"));
        transactionService.create(fixture.userId(), "statistics-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 11), 200_000, food, bank.assetId(),
                        fixture.memberId(), "생활비", 1));
        transactionService.create(fixture.userId(), "statistics-excluded-income",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 7, 11), 123_123, incomeOther, bank.assetId(),
                        fixture.memberId(), "달력·통계 제외 수입", true));
        transactionService.create(fixture.userId(), "statistics-excluded-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 11), 45_678, food, bank.assetId(),
                        fixture.memberId(), "달력·통계 제외 지출", 1, true));
        transactionService.create(fixture.userId(), "statistics-transfer",
                new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 12), 50_000, bank.assetId(), transferDestination.assetId(),
                        fixture.memberId(), "통계 제외 이체"));
        createManagedTransfer(fixture, bank, card, TransferSubtype.CARD_PREPAYMENT,
                "CARD_PREPAYMENT", 30_000);
        createManagedTransfer(fixture, bank, card, TransferSubtype.CARD_SETTLEMENT,
                "CARD_AUTOPAY", 20_000);
        TransactionService.TransactionView cardPurchase = transactionService.create(
                fixture.userId(), "statistics-card-purchase",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), 100_000, food, card.assetId(),
                        fixture.memberId(), "카드 구매", 1));
        CardPurchaseManagementService.CardPurchaseRefundPreview refundPreview =
                cardManagementService.previewRefund(
                        fixture.userId(), cardPurchase.transactionId(),
                        new CardPurchaseManagementService.RefundCommand(
                                LocalDate.of(2026, 7, 22), 40_000,
                                cardPurchase.version(), "부분 환불"));
        cardManagementService.refund(
                fixture.userId(), cardPurchase.transactionId(), "statistics-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 7, 22), 40_000,
                        cardPurchase.version(), "부분 환불", refundPreview.previewToken()));
        TransactionService.TransactionView deleted = transactionService.create(
                fixture.userId(), "statistics-deleted",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 13), 999_999, food, bank.assetId(),
                        fixture.memberId(), "삭제할 지출", 1));
        transactionService.delete(fixture.userId(), deleted.transactionId(), deleted.version());
        transactionService.create(fixture.userId(), "statistics-previous-month",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 6, 30), 777_777, incomeOther, bank.assetId(),
                        fixture.memberId(), null));
        transactionService.create(fixture.userId(), "statistics-next-month",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 8, 1), 888_888, food, bank.assetId(),
                        fixture.memberId(), null, 1));
        transactionService.create(fixture.userId(), "statistics-next-year",
                new TransactionService.CreateIncome(
                        LocalDate.of(2027, 1, 1), 999_999, incomeOther, bank.assetId(),
                        fixture.memberId(), null));

        MonthlyStatisticsService.MonthlyStatistics statistics = all(
                fixture.userId(), YearMonth.of(2026, 7));

        assertThat(statistics.periodStart()).isEqualTo(LocalDate.of(2026, 7, 1));
        assertThat(statistics.periodEndExclusive()).isEqualTo(LocalDate.of(2026, 8, 1));
        assertThat(statistics.totals()).isEqualTo(
                new MonthlyStatisticsService.Totals(500_000, 260_000, 240_000));
        assertThat(statistics.yearlyTrend()).hasSize(12);
        assertThat(statistics.yearlyTrend())
                .extracting(MonthlyStatisticsService.MonthSummary::month)
                .containsExactlyElementsOf(
                        IntStream.rangeClosed(1, 12)
                                .mapToObj(value -> YearMonth.of(2026, value))
                                .toList());
        assertThat(yearSummary(statistics, 6)).isEqualTo(
                new MonthlyStatisticsService.MonthSummary(
                        YearMonth.of(2026, 6), 777_777, 0, 777_777, AssetFormation.ZERO));
        assertThat(yearSummary(statistics, 7)).isEqualTo(
                new MonthlyStatisticsService.MonthSummary(
                        YearMonth.of(2026, 7), 500_000, 260_000, 240_000, AssetFormation.ZERO));
        assertThat(yearSummary(statistics, 8)).isEqualTo(
                new MonthlyStatisticsService.MonthSummary(
                        YearMonth.of(2026, 8), 0, 888_888, -888_888, AssetFormation.ZERO));
        assertThat(statistics.yearlyTrend())
                .noneMatch(summary -> summary.incomeWon() == 999_999);
        assertThat(statistics.dailyTrend())
                .as("구버전 PWA가 갱신 prompt까지 렌더링할 수 있는 빈 호환 필드")
                .isEmpty();
        assertThat(statistics.categoryBreakdown())
                .extracting(MonthlyStatisticsService.CategoryAmount::categoryId,
                        MonthlyStatisticsService.CategoryAmount::amountWon)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(incomeOther, 500_000L),
                        org.assertj.core.groups.Tuple.tuple(food, 260_000L));

        MonthlyStatisticsService.MonthlyStatistics emptyLeapMonth = all(
                fixture.userId(), YearMonth.of(2028, 2));
        assertThat(emptyLeapMonth.totals()).isEqualTo(
                new MonthlyStatisticsService.Totals(0, 0, 0));
        assertThat(emptyLeapMonth.categoryBreakdown()).isEmpty();
        assertThat(emptyLeapMonth.yearlyTrend()).hasSize(12)
                .allMatch(summary -> summary.incomeWon() == 0
                        && summary.expenseWon() == 0
                        && summary.netWon() == 0);
    }

    @Test
    void appliesMemberOwnerAndCategoryFiltersWithAndSemanticsUsingPrimaryAsset() {
        Fixture fixture = fixture("필터 사용자");
        UUID secondMember = addMember(fixture.bookId(), "두 번째 구성원");
        AssetService.AssetView ownerBank = asset(fixture.userId(), "BANK");
        jdbcTemplate.update("update asset set owner_member_id = ? where id = ?", secondMember, ownerBank.assetId());
        AssetService.AssetView ownerCash = assetService.create(
                fixture.userId(), "statistics-owner-cash",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "CASH"), AssetOwnershipScope.PERSONAL, fixture.memberId(),
                        "본인 현금", LocalDate.of(2026, 7, 1), null, 0, null));
        AssetService.AssetView secondMemberDebitCard = assetService.create(
                fixture.userId(), "statistics-second-debit-card",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "DEBIT_CARD"), AssetOwnershipScope.PERSONAL,
                        secondMember, "상대 체크카드", LocalDate.of(2026, 7, 1), null, 0,
                        null, new AssetService.DebitCardSettingsCommand(ownerBank.assetId()), null));
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        UUID medical = category(fixture.userId(), CategoryKind.EXPENSE, "MEDICAL");

        createExpense(fixture, "filter-1", 70_000, food,
                secondMemberDebitCard.assetId(), secondMember);
        createExpense(fixture, "filter-2", 30_000, food, ownerCash.assetId(), secondMember);
        createExpense(fixture, "filter-3", 20_000, food,
                secondMemberDebitCard.assetId(), fixture.memberId());
        createExpense(fixture, "filter-4", 10_000, medical,
                secondMemberDebitCard.assetId(), secondMember);

        assertThat(monthly(fixture.userId(), secondMember,
                AssetOwnerFilter.Type.ALL, null, null).totals().expenseWon()).isEqualTo(110_000);
        assertThat(monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.MEMBER, secondMember, null).totals().expenseWon()).isEqualTo(100_000);
        assertThat(monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.MEMBER, fixture.memberId(), null).totals().expenseWon()).isEqualTo(30_000);
        assertThat(monthly(fixture.userId(), secondMember,
                AssetOwnerFilter.Type.MEMBER, secondMember, food).totals().expenseWon()).isEqualTo(70_000);
        assertThat(monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.ALL, null, food).totals().expenseWon()).isEqualTo(120_000);

        jdbcTemplate.update("""
                update asset
                   set archived_at = now(), archived_by_member_id = ?
                 where id = ?
                """, fixture.memberId(), secondMemberDebitCard.assetId());
        assertThat(monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.MEMBER, secondMember, null).totals().expenseWon()).isEqualTo(100_000);

        jdbcTemplate.update("""
                update asset
                   set owner_member_id = ?
                 where id = ?
                """, fixture.memberId(), secondMemberDebitCard.assetId());
        assertThat(monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.MEMBER, secondMember, null).totals().expenseWon()).isZero();
        assertThat(monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.MEMBER, fixture.memberId(), null).totals().expenseWon()).isEqualTo(130_000);
    }

    @Test
    void reflectsCurrentCategoryNameAndFallbackRemap() {
        Fixture fixture = fixture("분류 통계 사용자");
        AssetService.AssetView bank = asset(fixture.userId(), "BANK");
        CategoryService.CategoryView custom = categoryService.create(
                fixture.userId(), new CategoryService.CreateCategoryCommand(
                        CategoryKind.EXPENSE, "외식"));
        createExpense(fixture, "category-statistics", 15_000,
                custom.categoryId(), bank.assetId(), fixture.memberId());

        CategoryService.CategoryView renamed = categoryService.update(
                fixture.userId(), custom.categoryId(),
                new CategoryService.UpdateCategoryCommand("맛집", custom.version()));
        assertThat(all(fixture.userId(), YearMonth.of(2026, 7)).categoryBreakdown())
                .filteredOn(category -> category.categoryId().equals(custom.categoryId()))
                .singleElement()
                .extracting(MonthlyStatisticsService.CategoryAmount::categoryName)
                .isEqualTo("맛집");

        UUID fallback = category(fixture.userId(), CategoryKind.EXPENSE, "OTHER");
        categoryService.archive(fixture.userId(), custom.categoryId(), renamed.version());
        MonthlyStatisticsService.MonthlyStatistics afterArchive = all(
                fixture.userId(), YearMonth.of(2026, 7));
        assertThat(afterArchive.categoryBreakdown())
                .extracting(MonthlyStatisticsService.CategoryAmount::categoryId,
                        MonthlyStatisticsService.CategoryAmount::amountWon)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(fallback, 15_000L));
        assertThatThrownBy(() -> monthly(fixture.userId(), null,
                AssetOwnerFilter.Type.ALL, null, custom.categoryId()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("STATISTICS_CATEGORY_INVALID"));
    }

    @Test
    void listsOnlyTransactionsContributingToTheSelectedMonthAndCategoryWithCursorPagination() {
        Fixture fixture = fixture("분류 거래 내역 사용자");
        AssetService.AssetView bank = asset(fixture.userId(), "BANK");
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        UUID medical = category(fixture.userId(), CategoryKind.EXPENSE, "MEDICAL");

        TransactionService.TransactionView older = transactionService.create(
                fixture.userId(), "category-details-older",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 3), 10_000, food, bank.assetId(),
                        fixture.memberId(), "오래된 식비", 1));
        TransactionService.TransactionView newer = transactionService.create(
                fixture.userId(), "category-details-newer",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), 20_000, food, bank.assetId(),
                        fixture.memberId(), "최근 식비", 1));
        transactionService.create(
                fixture.userId(), "category-details-excluded",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 21), 999_999, food, bank.assetId(),
                        fixture.memberId(), "집계 제외 식비", 1, true));
        createExpense(fixture, "category-details-other", 30_000,
                medical, bank.assetId(), fixture.memberId());
        transactionService.create(
                fixture.userId(), "category-details-next-month",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 8, 1), 40_000, food, bank.assetId(),
                        fixture.memberId(), "다음 달 식비", 1));

        MonthlyStatisticsService.CategoryTransactionPage first =
                statisticsService.categoryTransactions(
                        fixture.userId(), YearMonth.of(2026, 7), fixture.memberId(),
                        AssetOwnerFilter.Type.ALL, null, food, null, 1);

        assertThat(first.items()).singleElement().satisfies(item -> {
            assertThat(item.transactionId()).isEqualTo(newer.transactionId());
            assertThat(item.occurredOn()).isEqualTo(LocalDate.of(2026, 7, 20));
            assertThat(item.statisticsContributionWon()).isEqualTo(-20_000);
            assertThat(item.description()).isEqualTo("최근 식비");
            assertThat(item.categoryName()).isEqualTo("식비");
            assertThat(item.assetName()).isEqualTo(bank.name());
        });
        assertThat(first.nextCursor()).isNotBlank();

        MonthlyStatisticsService.CategoryTransactionPage second =
                statisticsService.categoryTransactions(
                        fixture.userId(), YearMonth.of(2026, 7), fixture.memberId(),
                        AssetOwnerFilter.Type.ALL, null, food, first.nextCursor(), 1);

        assertThat(second.items()).singleElement()
                .extracting(MonthlyStatisticsService.CategoryTransaction::transactionId)
                .isEqualTo(older.transactionId());
        assertThat(second.nextCursor()).isNull();
    }

    @Test
    void rejectsInvalidFilterShapesAndCrossLedgerReferences() {
        Fixture first = fixture("첫 가계부");
        Fixture second = fixture("둘째 가계부");
        UUID secondCategory = category(second.userId(), CategoryKind.EXPENSE, "FOOD");

        assertThatThrownBy(() -> monthly(first.userId(), second.memberId(),
                AssetOwnerFilter.Type.ALL, null, null))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("STATISTICS_MEMBER_INVALID"));
        assertThatThrownBy(() -> monthly(first.userId(), null,
                AssetOwnerFilter.Type.MEMBER, second.memberId(), null))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("STATISTICS_MEMBER_INVALID"));
        assertThatThrownBy(() -> monthly(first.userId(), null,
                AssetOwnerFilter.Type.ALL, null, secondCategory))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("STATISTICS_CATEGORY_INVALID"));
        assertThatThrownBy(() -> monthly(first.userId(), null,
                AssetOwnerFilter.Type.MEMBER, null, null))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("STATISTICS_FILTER_INVALID"));
        assertThatThrownBy(() -> monthly(first.userId(), null,
                AssetOwnerFilter.Type.ALL, first.memberId(), null))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("STATISTICS_FILTER_INVALID"));

        UUID userWithoutLedger = createUser("가계부 없는 사용자");
        assertThatThrownBy(() -> all(userWithoutLedger, YearMonth.of(2026, 7)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> {
                            assertThat(exception.getStatus().value()).isEqualTo(404);
                            assertThat(exception.getErrorCode()).isEqualTo("LEDGER_NOT_FOUND");
                        });
    }

    private MonthlyStatisticsService.MonthlyStatistics all(UUID userId, YearMonth month) {
        return statisticsService.monthly(
                userId, month, null, AssetOwnerFilter.Type.ALL, null, null);
    }

    private MonthlyStatisticsService.MonthlyStatistics monthly(
            UUID userId,
            UUID performedByMemberId,
            AssetOwnerFilter.Type ownerType,
            UUID ownerMemberId,
            UUID categoryId
    ) {
        return statisticsService.monthly(
                userId, YearMonth.of(2026, 7), performedByMemberId,
                ownerType, ownerMemberId, categoryId);
    }

    private MonthlyStatisticsService.MonthSummary yearSummary(
            MonthlyStatisticsService.MonthlyStatistics statistics,
            int month
    ) {
        return statistics.yearlyTrend().get(month - 1);
    }

    private void createExpense(
            Fixture fixture,
            String key,
            long amountWon,
            UUID categoryId,
            UUID assetId,
            UUID performedByMemberId
    ) {
        transactionService.create(fixture.userId(), key,
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 15), amountWon, categoryId,
                        assetId, performedByMemberId, key, 1));
    }

    private void createManagedTransfer(
            Fixture fixture,
            AssetService.AssetView source,
            AssetService.AssetView destination,
            TransferSubtype subtype,
            String sourceType,
            long amountWon
    ) {
        managedTransferPort.create(new ManagedTransferPort.CreateCommand(
                UUID.randomUUID(), fixture.bookId(), subtype, LocalDate.of(2026, 7, 14),
                amountWon, "통계 제외 카드 자산 이동", sourceType, UUID.randomUUID(),
                destination.ownerMemberId(), fixture.memberId(), Instant.now(), List.of(
                        new ManagedTransferPort.Posting(source.assetId(), -amountWon),
                        new ManagedTransferPort.Posting(destination.assetId(), amountWon))));
    }

    @Test
    void transferPurposesTrackGrossDepositsAndDatedWithdrawalsWithoutChangingConsumption() {
        Fixture f = fixture("납입 통계");
        var bank = asset(f.userId(), "BANK");
        var savings = formationAsset(f, "SAVINGS", f.memberId());
        var investment = formationAsset(f, "INVESTMENT", f.memberId());
        var deposit = purposeTransfer(f, "savings", "2026-07-01", bank.assetId(), savings.assetId(),
                500_000, TransferPurpose.SAVINGS_DEPOSIT, f.memberId());
        purposeTransfer(f, "investment", "2026-07-02", bank.assetId(), investment.assetId(),
                300_000, TransferPurpose.INVESTMENT_DEPOSIT, f.memberId());
        purposeTransfer(f, "withdraw", "2026-07-03", savings.assetId(), bank.assetId(),
                200_000, TransferPurpose.SAVINGS_WITHDRAWAL, f.memberId());
        purposeTransfer(f, "later-withdraw", "2026-08-01", investment.assetId(), bank.assetId(),
                400_000, TransferPurpose.INVESTMENT_WITHDRAWAL, f.memberId());
        purposeTransfer(f, "rebalance", "2026-07-04", savings.assetId(), investment.assetId(),
                50_000, TransferPurpose.GENERAL, f.memberId());
        var july = monthly(f.userId(), null, AssetOwnerFilter.Type.ALL, null, null);
        assertThat(july.assetFormation()).isEqualTo(new AssetFormation(500_000, 200_000, 300_000, 0));
        assertThat(july.totals().expenseWon()).isZero();
        assertThat(july.totals().incomeWon()).isZero();
        assertThat(july.yearlyTrend()).hasSize(12);
        assertThat(july.yearlyTrend().get(6).assetFormation()).isEqualTo(july.assetFormation());
        assertThat(july.yearlyTrend().get(7).assetFormation()).isEqualTo(new AssetFormation(0, 0, 0, 400_000));
        assertThat(july.yearlyTrend().get(0).assetFormation()).isEqualTo(AssetFormation.ZERO);
        assertThat(deposit.postings()).hasSize(2);
        assertThat(deposit.postings().stream().mapToLong(TransactionService.PostingView::deltaWon).sum()).isZero();
        assertThat(assetService.asset(f.userId(), savings.assetId()).currentBalanceWon()).isEqualTo(250_000);
        assertThat(assetService.asset(f.userId(), investment.assetId()).currentBalanceWon()).isEqualTo(-50_000);
        assertThat(transactionService.calendar(f.userId(), YearMonth.of(2026, 7)).totalExpenseWon()).isZero();

        var replay = purposeTransfer(f, "savings", "2026-07-01", bank.assetId(), savings.assetId(),
                500_000, TransferPurpose.SAVINGS_DEPOSIT, f.memberId());
        assertThat(replay.transactionId()).isEqualTo(deposit.transactionId());
        assertThatThrownBy(() -> purposeTransfer(f, "savings", "2026-07-01", bank.assetId(), savings.assetId(),
                500_000, TransferPurpose.GENERAL, f.memberId())).isInstanceOf(ApiException.class)
                .hasMessageContaining("중복 방지 키");

        var changed = transactionService.update(f.userId(), deposit.transactionId(), new TransactionService.UpdateCommand(
                TransactionType.TRANSFER, deposit.occurredOn(), deposit.amountWon(), null, null,
                bank.assetId(), savings.assetId(), f.memberId(), null, deposit.version(), false, 1,
                deposit.amountWon(), TransferPurpose.GENERAL));
        assertThat(changed.transferPurpose()).isEqualTo(TransferPurpose.GENERAL);
        assertThat(assetService.asset(f.userId(), savings.assetId()).currentBalanceWon()).isEqualTo(250_000);
        assertThat(monthly(f.userId(), null, AssetOwnerFilter.Type.ALL, null, null).assetFormation().savingsDepositWon()).isZero();
        assertThatThrownBy(() -> transactionService.update(f.userId(), deposit.transactionId(), new TransactionService.UpdateCommand(
                TransactionType.TRANSFER, deposit.occurredOn(), deposit.amountWon(), null, null,
                bank.assetId(), savings.assetId(), f.memberId(), null, deposit.version(), false, 1,
                deposit.amountWon(), TransferPurpose.INVESTMENT_DEPOSIT))).isInstanceOf(ApiException.class)
                .hasMessageContaining("편집하는 동안");
    }

    @Test
    void transferPurposeFiltersUsePerformerAndFormationSideOwnerAndExcludeOtherLedgers() {
        Fixture f = fixture("목적 필터");
        UUID other = addMember(f.bookId(), "적금 명의자");
        var bank = asset(f.userId(), "BANK");
        jdbcTemplate.update("update asset set owner_member_id = ? where id = ?", other, bank.assetId());
        var savings = formationAsset(f, "SAVINGS", other);
        var deposit = purposeTransfer(f, "owned-deposit", "2026-07-01", bank.assetId(), savings.assetId(),
                700_000, TransferPurpose.SAVINGS_DEPOSIT, f.memberId());
        purposeTransfer(f, "owned-withdraw", "2026-07-02", savings.assetId(), bank.assetId(),
                100_000, TransferPurpose.SAVINGS_WITHDRAWAL, f.memberId());
        assertThat(monthly(f.userId(), f.memberId(), AssetOwnerFilter.Type.MEMBER, other, null).assetFormation())
                .isEqualTo(new AssetFormation(700_000, 100_000, 0, 0));
        assertThat(monthly(f.userId(), other, AssetOwnerFilter.Type.ALL, null, null).assetFormation()).isEqualTo(AssetFormation.ZERO);
        assertThat(monthly(f.userId(), null, AssetOwnerFilter.Type.MEMBER, f.memberId(), null).assetFormation()).isEqualTo(AssetFormation.ZERO);
        assertThat(monthly(f.userId(), null, AssetOwnerFilter.Type.ALL, null,
                category(f.userId(), CategoryKind.EXPENSE, "FOOD")).assetFormation()).isEqualTo(AssetFormation.ZERO);
        Fixture stranger = fixture("다른 가계부");
        assertThat(monthly(stranger.userId(), null, AssetOwnerFilter.Type.ALL, null, null).assetFormation()).isEqualTo(AssetFormation.ZERO);
        assertThatThrownBy(() -> purposeTransfer(stranger, "cross-book", "2026-07-01",
                asset(stranger.userId(), "BANK").assetId(), savings.assetId(), 10_000,
                TransferPurpose.SAVINGS_DEPOSIT, stranger.memberId())).isInstanceOf(ApiException.class);
        var legacyEdit = transactionService.update(f.userId(), deposit.transactionId(), new TransactionService.UpdateCommand(
                TransactionType.TRANSFER, deposit.occurredOn(), deposit.amountWon(), null, null,
                bank.assetId(), savings.assetId(), f.memberId(), "이전 앱 수정", deposit.version()));
        assertThat(legacyEdit.transferPurpose()).isEqualTo(TransferPurpose.SAVINGS_DEPOSIT);
        transactionService.delete(f.userId(), deposit.transactionId(), legacyEdit.version());
        assertThat(monthly(f.userId(), null, AssetOwnerFilter.Type.ALL, null, null).assetFormation())
                .isEqualTo(new AssetFormation(0, 100_000, 0, 0));
        assertThatThrownBy(() -> new TransactionService.UpdateCommand(TransactionType.INCOME,
                LocalDate.of(2026, 7, 1), 100, null, bank.assetId(), null, null, f.memberId(),
                null, 0, false, 1, 100, TransferPurpose.SAVINGS_DEPOSIT)).isInstanceOf(ApiException.class);
    }

    @Test
    void anchoredTransfersRemainInStatisticsAndLegacyCreatesDefaultToGeneral() {
        Fixture f = fixture("기준일 납입");
        var bank = asset(f.userId(), "BANK");
        var savings = assetService.create(f.userId(), "anchored-savings", new AssetService.AssetCommand(
                assetType(f.userId(), "SAVINGS"), AssetOwnershipScope.PERSONAL, f.memberId(),
                "기준일 적금", LocalDate.of(2026, 7, 15), null, 900_000, null));
        purposeTransfer(f, "before-anchor", "2026-07-01", bank.assetId(), savings.assetId(),
                500_000, TransferPurpose.SAVINGS_DEPOSIT, f.memberId());
        purposeTransfer(f, "on-anchor", "2026-07-15", bank.assetId(), savings.assetId(),
                200_000, TransferPurpose.SAVINGS_DEPOSIT, f.memberId());
        var general = transactionService.create(f.userId(), "legacy", new TransactionService.CreateTransfer(
                LocalDate.of(2026, 7, 16), 10_000, bank.assetId(), savings.assetId(), f.memberId(), null));
        assertThat(general.transferPurpose()).isEqualTo(TransferPurpose.GENERAL);
        assertThat(assetService.asset(f.userId(), savings.assetId()).currentBalanceWon()).isEqualTo(1_110_000);
        assertThat(monthly(f.userId(), null, AssetOwnerFilter.Type.ALL, null, null).assetFormation().savingsDepositWon()).isEqualTo(700_000);
    }

    private AssetService.AssetView formationAsset(Fixture f, String code, UUID owner) {
        return assetService.create(f.userId(), "formation-" + code, new AssetService.AssetCommand(
                assetType(f.userId(), code), AssetOwnershipScope.PERSONAL, owner,
                "목적 " + code, LocalDate.of(2026, 1, 1), null, 0, null));
    }

    private TransactionService.TransactionView purposeTransfer(Fixture f, String key, String date,
            UUID source, UUID destination, long amount, TransferPurpose purpose, UUID performer) {
        return transactionService.create(f.userId(), key, new TransactionService.CreateTransfer(
                LocalDate.parse(date), amount, source, destination, performer, null, purpose));
    }

    private Fixture fixture(String displayName) {
        UUID userId = createUser(displayName);
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(userId);
        UUID memberId = book.members().stream()
                .filter(MembershipService.LedgerMemberView::currentUser)
                .findFirst().orElseThrow().memberId();
        return new Fixture(userId, book.ledgerId(), memberId);
    }

    private AssetService.AssetView asset(UUID userId, String systemCode) {
        return assetService.assets(userId).stream()
                .filter(asset -> systemCode.equals(asset.systemCode()))
                .findFirst().orElseThrow();
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

    private UUID addMember(UUID bookId, String displayName) {
        UUID userId = createUser(displayName);
        UUID memberId = UUID.randomUUID();
        jdbcTemplate.update("""
                insert into ledger_member (id, book_id, user_id, joined_at)
                values (?, ?, ?, now())
                """, memberId, bookId, userId);
        return memberId;
    }

    private UUID createUser(String displayName) {
        UUID userId = UUID.randomUUID();
        users.add(userId);
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into app_user (
                    id, display_name, email, status, email_verified_at,
                    locale, time_zone, created_at, updated_at, version
                ) values (?, ?, ?, 'ACTIVE', ?, 'ko-KR', 'Asia/Seoul', ?, ?, 0)
                """, userId, displayName, userId + "@statistics.test", now, now, now);
        return userId;
    }

    private record Fixture(UUID userId, UUID bookId, UUID memberId) {
    }
}
