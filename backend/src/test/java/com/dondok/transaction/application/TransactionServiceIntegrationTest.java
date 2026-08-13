package com.dondok.transaction.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.category.application.CategoryService;
import com.dondok.category.domain.CategoryKind;
import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import com.dondok.transaction.domain.TransactionType;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class TransactionServiceIntegrationTest {
    @Autowired private TransactionService transactionService;
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
    void incomeExpenseAndTransferCreatePostingsCalendarAndCursorRows() {
        Fixture fixture = fixture();
        UUID performer = addMember(fixture.bookId(), "거래 주체");
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "주거래 계좌", 1_000, "asset-bank");
        AssetService.AssetView secondBank = createStandardAsset(
                fixture, "BANK", "보조 계좌", 0, "asset-second-bank");
        UUID incomeCategory = category(fixture.userId(), CategoryKind.INCOME, "OTHER");
        UUID expenseCategory = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        TransactionService.TransactionView income = transactionService.create(
                fixture.userId(), "income-1", new TransactionService.CreateIncome(
                        LocalDate.of(2026, 7, 10), 100, incomeCategory, bank.assetId(), performer, "월급"));
        TransactionService.TransactionView expense = transactionService.create(
                fixture.userId(), "expense-1", new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 11), 30, expenseCategory, bank.assetId(), performer, "식사", 1));
        TransactionService.TransactionView transfer = transactionService.create(
                fixture.userId(), "transfer-1", new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 12), 20, bank.assetId(), secondBank.assetId(), performer, "계좌 이체"));

        assertThat(income.postings()).extracting(TransactionService.PostingView::deltaWon)
                .containsExactly(100L);
        assertThat(expense.postings()).extracting(TransactionService.PostingView::deltaWon)
                .containsExactly(-30L);
        assertThat(transfer.postings()).extracting(TransactionService.PostingView::deltaWon)
                .containsExactly(-20L, 20L);
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(1_050);
        assertThat(assetService.asset(fixture.userId(), secondBank.assetId()).currentBalanceWon())
                .isEqualTo(20);
        assertThat(income.performedBy().memberId()).isEqualTo(performer);
        assertThat(income.createdBy().memberId()).isEqualTo(fixture.memberId());

        TransactionService.CalendarView calendar = transactionService.calendar(
                fixture.userId(), YearMonth.of(2026, 7));
        assertThat(calendar.totalIncomeWon()).isEqualTo(100);
        assertThat(calendar.totalExpenseWon()).isEqualTo(30);
        assertThat(calendar.netWon()).isEqualTo(70);
        assertThat(calendar.days()).extracting(TransactionService.DaySummary::date)
                .containsExactly(LocalDate.of(2026, 7, 10), LocalDate.of(2026, 7, 11));

        TransactionService.TransactionPage first = transactionService.transactions(
                fixture.userId(), LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1), null, 1);
        assertThat(first.items()).singleElement().satisfies(item -> {
            assertThat(item.type()).isEqualTo(TransactionType.TRANSFER);
            assertThat(item.postings()).hasSize(2);
        });
        assertThat(first.nextCursor()).isNotBlank();
        TransactionService.TransactionPage remaining = transactionService.transactions(
                fixture.userId(), LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1),
                first.nextCursor(), 10);
        assertThat(remaining.items()).extracting(TransactionService.TransactionView::transactionId)
                .containsExactly(expense.transactionId(), income.transactionId());
        assertThat(remaining.items()).allMatch(item -> item.type() != null);
        assertThat(count("select count(*) from ledger_transaction where book_id = ? and source_type = 'OPENING_BALANCE'",
                fixture.bookId())).isEqualTo(1);
    }

    @Test
    void calendarAndLedgerRowsCanBeFilteredByEconomicPerformer() {
        Fixture fixture = fixture();
        UUID partnerMemberId = addMember(fixture.bookId(), "함께 쓰는 사람");
        AssetService.AssetView account = createStandardAsset(
                fixture, "BANK", "구성원 필터 계좌", 0, "member-filter-account");
        UUID incomeCategory = category(fixture.userId(), CategoryKind.INCOME, "OTHER");
        UUID expenseCategory = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        TransactionService.TransactionView myIncome = transactionService.create(
                fixture.userId(), "member-filter-my-income",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 8, 3), 100_000, incomeCategory,
                        account.assetId(), fixture.memberId(), "내 수입"));
        TransactionService.TransactionView myExpense = transactionService.create(
                fixture.userId(), "member-filter-my-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 8, 4), 30_000, expenseCategory,
                        account.assetId(), fixture.memberId(), "내 지출", 1));
        TransactionService.TransactionView partnerIncome = transactionService.create(
                fixture.userId(), "member-filter-partner-income",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 8, 5), 70_000, incomeCategory,
                        account.assetId(), partnerMemberId, "상대 수입"));
        TransactionService.TransactionView partnerExpense = transactionService.create(
                fixture.userId(), "member-filter-partner-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 8, 6), 20_000, expenseCategory,
                        account.assetId(), partnerMemberId, "상대 지출", 1));

        assertThat(transactionService.calendar(
                fixture.userId(), YearMonth.of(2026, 8), fixture.memberId()))
                .satisfies(calendar -> {
                    assertThat(calendar.totalIncomeWon()).isEqualTo(100_000);
                    assertThat(calendar.totalExpenseWon()).isEqualTo(30_000);
                    assertThat(calendar.days()).extracting(TransactionService.DaySummary::date)
                            .containsExactly(LocalDate.of(2026, 8, 3), LocalDate.of(2026, 8, 4));
                });
        assertThat(transactionService.calendar(
                fixture.userId(), YearMonth.of(2026, 8), partnerMemberId))
                .satisfies(calendar -> {
                    assertThat(calendar.totalIncomeWon()).isEqualTo(70_000);
                    assertThat(calendar.totalExpenseWon()).isEqualTo(20_000);
                    assertThat(calendar.days()).extracting(TransactionService.DaySummary::date)
                            .containsExactly(LocalDate.of(2026, 8, 5), LocalDate.of(2026, 8, 6));
                });
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 8)))
                .satisfies(calendar -> {
                    assertThat(calendar.totalIncomeWon()).isEqualTo(170_000);
                    assertThat(calendar.totalExpenseWon()).isEqualTo(50_000);
                });

        assertThat(transactionService.transactions(
                fixture.userId(), LocalDate.of(2026, 8, 1), LocalDate.of(2026, 9, 1),
                null, 10, fixture.memberId()).items())
                .extracting(TransactionService.TransactionView::transactionId)
                .containsExactly(myExpense.transactionId(), myIncome.transactionId());
        assertThat(transactionService.transactions(
                fixture.userId(), LocalDate.of(2026, 8, 1), LocalDate.of(2026, 9, 1),
                null, 10, partnerMemberId).items())
                .extracting(TransactionService.TransactionView::transactionId)
                .containsExactly(partnerExpense.transactionId(), partnerIncome.transactionId());

        assertThatThrownBy(() -> transactionService.calendar(
                fixture.userId(), YearMonth.of(2026, 8), UUID.randomUUID()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("TRANSACTION_PERFORMER_INVALID"));
    }

    @Test
    void excludedIncomeAndExpenseChangeBalanceStayVisibleAndCanReturnToAggregates() {
        Fixture fixture = fixture();
        AssetService.AssetView account = createStandardAsset(
                fixture, "BANK", "집계 제외 계좌", 10_000, "excluded-statistics-account");
        UUID incomeCategory = category(fixture.userId(), CategoryKind.INCOME, "OTHER");
        UUID expenseCategory = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        TransactionService.TransactionView income = transactionService.create(
                fixture.userId(), "excluded-income",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 7, 10), 1_000, incomeCategory, account.assetId(),
                        fixture.memberId(), "집계 제외 수입", true));
        TransactionService.TransactionView expense = transactionService.create(
                fixture.userId(), "excluded-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 11), 300, expenseCategory, account.assetId(),
                        fixture.memberId(), "집계 제외 지출", 1, true));

        assertThat(income.excludedFromStatistics()).isTrue();
        assertThat(expense.excludedFromStatistics()).isTrue();
        assertThat(assetService.asset(fixture.userId(), account.assetId()).currentBalanceWon())
                .isEqualTo(10_700);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)))
                .satisfies(calendar -> {
                    assertThat(calendar.totalIncomeWon()).isZero();
                    assertThat(calendar.totalExpenseWon()).isZero();
                    assertThat(calendar.days()).isEmpty();
                });
        assertThat(transactionService.transactions(
                fixture.userId(), LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1), null, 10).items())
                .extracting(TransactionService.TransactionView::transactionId)
                .contains(income.transactionId(), expense.transactionId());

        TransactionService.TransactionView includedExpense = transactionService.update(
                fixture.userId(), expense.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, expense.occurredOn(), expense.amountWon(),
                        expenseCategory, account.assetId(), null, null, fixture.memberId(),
                        expense.description(), expense.version(), false));

        assertThat(includedExpense.excludedFromStatistics()).isFalse();
        assertThat(assetService.asset(fixture.userId(), account.assetId()).currentBalanceWon())
                .isEqualTo(10_700);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)))
                .satisfies(calendar -> {
                    assertThat(calendar.totalIncomeWon()).isZero();
                    assertThat(calendar.totalExpenseWon()).isEqualTo(300);
                });
    }

    @Test
    void memberCanTransferBetweenBankAccountsOwnedByDifferentLedgerMembers() {
        Fixture fixture = fixture();
        UUID partnerMemberId = addMember(fixture.bookId(), "함께 관리하는 구성원");
        UUID bankTypeId = assetType(fixture.userId(), "BANK");
        AssetService.AssetView myAccount = assetService.create(
                fixture.userId(), "cross-owner-transfer-source",
                new AssetService.AssetCommand(
                        bankTypeId, AssetOwnershipScope.PERSONAL, fixture.memberId(),
                        "내 계좌", LocalDate.of(2026, 7, 1), null, 500_000, null));
        AssetService.AssetView partnerAccount = assetService.create(
                fixture.userId(), "cross-owner-transfer-destination",
                new AssetService.AssetCommand(
                        bankTypeId, AssetOwnershipScope.PERSONAL, partnerMemberId,
                        "상대 계좌", LocalDate.of(2026, 7, 1), null, 20_000, null));

        TransactionService.TransactionView transfer = transactionService.create(
                fixture.userId(), "cross-owner-transfer",
                new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 12), 210_000,
                        myAccount.assetId(), partnerAccount.assetId(), partnerMemberId,
                        "구성원 간 이체"));

        assertThat(transfer.postings()).satisfiesExactly(
                source -> {
                    assertThat(source.assetId()).isEqualTo(myAccount.assetId());
                    assertThat(source.deltaWon()).isEqualTo(-210_000);
                },
                destination -> {
                    assertThat(destination.assetId()).isEqualTo(partnerAccount.assetId());
                    assertThat(destination.deltaWon()).isEqualTo(210_000);
                });
        assertThat(transfer.performedBy().memberId()).isEqualTo(partnerMemberId);
        assertThat(transfer.createdBy().memberId()).isEqualTo(fixture.memberId());
        assertThat(assetService.asset(fixture.userId(), myAccount.assetId()).currentBalanceWon())
                .isEqualTo(290_000);
        assertThat(assetService.asset(fixture.userId(), partnerAccount.assetId()).currentBalanceWon())
                .isEqualTo(230_000);
        assertThat(assetService.asset(fixture.userId(), myAccount.assetId()).ownerMemberId())
                .isEqualTo(fixture.memberId());
        assertThat(assetService.asset(fixture.userId(), partnerAccount.assetId()).ownerMemberId())
                .isEqualTo(partnerMemberId);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)))
                .satisfies(calendar -> {
                    assertThat(calendar.totalIncomeWon()).isZero();
                    assertThat(calendar.totalExpenseWon()).isZero();
                });
    }

    @Test
    void balanceAnchorAbsorbsEarlierTransactionsButKeepsThemInStatistics() {
        Fixture fixture = fixture();
        AssetService.AssetView account = assetService.create(
                fixture.userId(), "balance-anchor-account",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "기준 잔액 계좌", LocalDate.of(2026, 8, 3), null,
                        100_000, null));
        UUID expenseCategory = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        UUID incomeCategory = category(fixture.userId(), CategoryKind.INCOME, "OTHER");

        TransactionService.TransactionView earlierExpense = transactionService.create(
                fixture.userId(), "expense-before-balance-anchor",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 8, 2), 20_000, expenseCategory,
                        account.assetId(), fixture.memberId(), "기준일 전 지출", 1));

        AssetService.AssetView afterEarlierExpense = assetService.asset(
                fixture.userId(), account.assetId());
        assertThat(afterEarlierExpense.openingBalanceWon()).isEqualTo(100_000);
        assertThat(afterEarlierExpense.currentBalanceWon()).isEqualTo(100_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 8)).totalExpenseWon())
                .isEqualTo(20_000);

        transactionService.create(
                fixture.userId(), "income-on-balance-anchor",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 8, 3), 5_000, incomeCategory,
                        account.assetId(), fixture.memberId(), "기준일 수입"));

        assertThat(assetService.asset(fixture.userId(), account.assetId()).currentBalanceWon())
                .isEqualTo(105_000);

        TransactionService.TransactionView movedAfterAnchor = transactionService.update(
                fixture.userId(), earlierExpense.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, LocalDate.of(2026, 8, 4), 20_000,
                        expenseCategory, account.assetId(), null, null, fixture.memberId(),
                        earlierExpense.description(), earlierExpense.version()));
        assertThat(assetService.asset(fixture.userId(), account.assetId()).currentBalanceWon())
                .isEqualTo(85_000);

        transactionService.delete(
                fixture.userId(), movedAfterAnchor.transactionId(), movedAfterAnchor.version());
        assertThat(assetService.asset(fixture.userId(), account.assetId()).currentBalanceWon())
                .isEqualTo(105_000);
    }

    @Test
    void cardInstallmentsSplitRemainderAndCreateStatementsAndSchedulesAtomically() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "결제 계좌", 0, "card-bank");
        UUID cardType = assetType(fixture.userId(), "CREDIT_CARD");
        AssetService.AssetView card = assetService.create(fixture.userId(), "card-asset",
                new AssetService.AssetCommand(
                        cardType, AssetOwnershipScope.PERSONAL, fixture.memberId(), "생활비 카드",
                        LocalDate.of(2026, 7, 1), null, 0,
                        new AssetService.CardSettingsCommand(14, 25, 1, bank.assetId(), true)));
        UUID category = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        TransactionService.TransactionView created = transactionService.create(
                fixture.userId(), "card-expense", new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), 100, category, card.assetId(),
                        fixture.memberId(), "3개월 할부", 3));

        assertThat(created.installmentCount()).isEqualTo(3);
        assertThat(created.postings()).extracting(TransactionService.PostingView::deltaWon)
                .containsExactly(-100L);
        assertThat(jdbcTemplate.queryForList("""
                select principal_amount_won from card_charge
                 where source_transaction_id = ? order by installment_no
                """, Long.class, created.transactionId())).containsExactly(34L, 33L, 33L);
        assertThat(queryLong("""
                select sum(statement.billed_amount_won)
                  from card_statement statement
                 where statement.id in (
                    select charge.statement_id from card_charge charge where charge.source_transaction_id = ?
                 )
                """, created.transactionId())).isEqualTo(100);
        assertThat(count("""
                select count(*) from card_payment_schedule schedule
                 where schedule.statement_id in (
                    select charge.statement_id from card_charge charge where charge.source_transaction_id = ?
                 )
                """, created.transactionId())).isEqualTo(3);
    }

    @Test
    void cardPurchaseBeforeBalanceAnchorStaysInStatisticsWithoutIncreasingPaymentDue() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "카드 결제 계좌", 500_000, "anchor-card-bank");
        UUID cardType = assetType(fixture.userId(), "CREDIT_CARD");
        AssetService.CardSettingsCommand cardSettings = new AssetService.CardSettingsCommand(
                14, 25, 1, bank.assetId(), true);
        AssetService.AssetView card = assetService.create(
                fixture.userId(), "anchor-card",
                new AssetService.AssetCommand(
                        cardType, AssetOwnershipScope.PERSONAL, fixture.memberId(), "기준일 카드",
                        LocalDate.of(2026, 8, 3), null, -100_000, cardSettings));
        UUID category = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        TransactionService.TransactionView historicalPurchase = transactionService.create(
                fixture.userId(), "anchor-card-historical-purchase",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 8, 2), 20_000, category, card.assetId(),
                        fixture.memberId(), "기준일 전 카드 지출", 1));

        assertThat(assetService.asset(fixture.userId(), card.assetId()).currentBalanceWon())
                .isEqualTo(-100_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 8)).totalExpenseWon())
                .isEqualTo(20_000);
        assertThat(jdbcTemplate.queryForObject("""
                select absorbed_by_balance_anchor
                  from card_charge
                 where source_transaction_id = ?
                """, Boolean.class, historicalPurchase.transactionId())).isTrue();
        assertThat(queryLong("""
                select coalesce(sum(forecast.payment_amount_won), 0)
                  from card_statement_forecast forecast
                 where forecast.card_asset_id = ?
                   and forecast.status in ('OPEN', 'FINALIZED')
                """, card.assetId())).isEqualTo(100_000);

        AssetService.AssetView reanchored = assetService.update(
                fixture.userId(), card.assetId(), new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                cardType, AssetOwnershipScope.PERSONAL, fixture.memberId(), "기준일 카드",
                                LocalDate.of(2026, 8, 2), null, -100_000, cardSettings),
                        card.version(), false));

        assertThat(reanchored.currentBalanceWon()).isEqualTo(-120_000);
        assertThat(jdbcTemplate.queryForObject("""
                select absorbed_by_balance_anchor
                  from card_charge
                 where source_transaction_id = ?
                """, Boolean.class, historicalPurchase.transactionId())).isFalse();
        assertThat(queryLong("""
                select coalesce(sum(forecast.payment_amount_won), 0)
                  from card_statement_forecast forecast
                 where forecast.card_asset_id = ?
                   and forecast.status in ('OPEN', 'FINALIZED')
                """, card.assetId())).isEqualTo(120_000);
    }

    @Test
    void debitCardExpenseUsesItsLinkedPaymentAccountWithoutDoubleCountingTheCard() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "생활비 계좌", 500_000, "debit-bank");
        AssetService.AssetView debitCard = assetService.create(
                fixture.userId(), "debit-card",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "DEBIT_CARD"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "생활비 체크카드", LocalDate.of(2026, 7, 1), null, 0,
                        null, new AssetService.DebitCardSettingsCommand(bank.assetId()), null));
        UUID category = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");

        TransactionService.TransactionView created = transactionService.create(
                fixture.userId(), "debit-expense", new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), 35_000, category, debitCard.assetId(),
                        fixture.memberId(), "체크카드 식비", 1));

        assertThat(created.asset()).isNotNull();
        assertThat(created.asset().assetId()).isEqualTo(debitCard.assetId());
        assertThat(created.postings()).singleElement().satisfies(posting -> {
            assertThat(posting.assetId()).isEqualTo(bank.assetId());
            assertThat(posting.deltaWon()).isEqualTo(-35_000);
        });
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon()).isEqualTo(465_000);
        assertThat(assetService.asset(fixture.userId(), debitCard.assetId()).currentBalanceWon()).isZero();
    }

    @Test
    void idempotencyReturnsOneTransactionAndRejectsPayloadReuse() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(fixture, "BANK", "멱등 계좌", 0, "idem-bank");
        UUID category = category(fixture.userId(), CategoryKind.INCOME, "OTHER");
        TransactionService.CreateIncome command = new TransactionService.CreateIncome(
                LocalDate.of(2026, 7, 1), 500, category, bank.assetId(), fixture.memberId(), null);

        TransactionService.TransactionView first = transactionService.create(fixture.userId(), "same-key", command);
        TransactionService.TransactionView retried = transactionService.create(fixture.userId(), "same-key", command);

        assertThat(retried.transactionId()).isEqualTo(first.transactionId());
        assertThat(count("select count(*) from ledger_transaction where id = ?", first.transactionId())).isOne();
        assertThatThrownBy(() -> transactionService.create(fixture.userId(), "same-key",
                new TransactionService.CreateIncome(
                        LocalDate.of(2026, 7, 1), 501, category, bank.assetId(), fixture.memberId(), null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("IDEMPOTENCY_KEY_REUSED"));
    }

    @Test
    void assetsCategoriesAndPerformersFromAnotherLedgerAreRejected() {
        Fixture first = fixture();
        Fixture second = fixture();
        AssetService.AssetView firstBank = createStandardAsset(first, "BANK", "첫 계좌", 0, "first-bank");
        AssetService.AssetView secondBank = createStandardAsset(second, "BANK", "둘째 계좌", 0, "second-bank");
        UUID firstCategory = category(first.userId(), CategoryKind.INCOME, "OTHER");
        UUID secondCategory = category(second.userId(), CategoryKind.INCOME, "OTHER");

        assertThatThrownBy(() -> transactionService.create(first.userId(), "cross-asset",
                new TransactionService.CreateIncome(LocalDate.of(2026, 7, 1), 1,
                        firstCategory, secondBank.assetId(), first.memberId(), null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("TRANSACTION_ASSET_INVALID"));
        assertThatThrownBy(() -> transactionService.create(first.userId(), "cross-category",
                new TransactionService.CreateIncome(LocalDate.of(2026, 7, 1), 1,
                        secondCategory, firstBank.assetId(), first.memberId(), null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("TRANSACTION_CATEGORY_INVALID"));
        assertThatThrownBy(() -> transactionService.create(first.userId(), "cross-performer",
                new TransactionService.CreateIncome(LocalDate.of(2026, 7, 1), 1,
                        firstCategory, firstBank.assetId(), second.memberId(), null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("TRANSACTION_PERFORMER_INVALID"));
    }

    @Test
    void normalTransferRejectsNonBankSourceAndDestinationAssets() {
        Fixture fixture = fixture();
        AssetService.AssetView firstBank = createStandardAsset(
                fixture, "BANK", "첫 계좌", 100_000, "transfer-bank-first");
        AssetService.AssetView secondBank = createStandardAsset(
                fixture, "BANK", "둘째 계좌", 0, "transfer-bank-second");
        AssetService.AssetView cash = createStandardAsset(
                fixture, "CASH", "보조 현금", 0, "transfer-cash");

        assertThatThrownBy(() -> transactionService.create(
                fixture.userId(), "transfer-cash-source",
                new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 1), 10_000, cash.assetId(), secondBank.assetId(),
                        fixture.memberId(), "현금 출발")))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("TRANSFER_BANK_ACCOUNT_REQUIRED"));
        assertThat(count("""
                select count(*) from ledger_transaction
                 where book_id = ? and source_type = 'MANUAL'
                """, fixture.bookId())).isZero();
        assertThat(assetService.asset(fixture.userId(), firstBank.assetId()).currentBalanceWon())
                .isEqualTo(100_000);
        assertThat(assetService.asset(fixture.userId(), secondBank.assetId()).currentBalanceWon())
                .isZero();
        assertThat(assetService.asset(fixture.userId(), cash.assetId()).currentBalanceWon())
                .isZero();

        TransactionService.TransactionView valid = transactionService.create(
                fixture.userId(), "transfer-bank-to-bank",
                new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 1), 10_000, firstBank.assetId(), secondBank.assetId(),
                        fixture.memberId(), "정상 이체"));
        assertThatThrownBy(() -> transactionService.update(
                fixture.userId(), valid.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.TRANSFER, valid.occurredOn(), valid.amountWon(),
                        null, null, firstBank.assetId(), cash.assetId(), fixture.memberId(),
                        valid.description(), valid.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("TRANSFER_BANK_ACCOUNT_REQUIRED"));
        assertThat(transactionService.transaction(fixture.userId(), valid.transactionId()).version())
                .isEqualTo(valid.version());
        assertThat(transactionService.transaction(fixture.userId(), valid.transactionId()).postings())
                .extracting(TransactionService.PostingView::assetId)
                .containsExactly(firstBank.assetId(), secondBank.assetId());
        assertThatThrownBy(() -> transactionService.create(
                fixture.userId(), "transfer-cash-destination",
                new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 1), 10_000, firstBank.assetId(), cash.assetId(),
                        fixture.memberId(), "현금 도착")))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("TRANSFER_BANK_ACCOUNT_REQUIRED"));
    }

    @Test
    void generalExpenseUpdateAndDeleteRebuildPostingsAndRejectStaleVersions() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "주거래 계좌", 100_000, "update-bank");
        AssetService.AssetView cash = createStandardAsset(
                fixture, "CASH", "수정 현금", 10_000, "update-cash");
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        UUID medical = category(fixture.userId(), CategoryKind.EXPENSE, "MEDICAL");
        TransactionService.TransactionView created = transactionService.create(
                fixture.userId(), "update-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 10), 20_000, food, bank.assetId(),
                        fixture.memberId(), "처음", 1));

        TransactionService.TransactionView updated = transactionService.update(
                fixture.userId(), created.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, LocalDate.of(2026, 8, 2), 3_000,
                        medical, cash.assetId(), null, null, fixture.memberId(),
                        "수정", created.version()));

        assertThat(updated.version()).isEqualTo(created.version() + 1);
        assertThat(updated.createdBy()).isEqualTo(created.createdBy());
        assertThat(updated.category().categoryId()).isEqualTo(medical);
        assertThat(updated.postings()).singleElement().satisfies(posting -> {
            assertThat(posting.assetId()).isEqualTo(cash.assetId());
            assertThat(posting.deltaWon()).isEqualTo(-3_000);
        });
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(100_000);
        assertThat(assetService.asset(fixture.userId(), cash.assetId()).currentBalanceWon())
                .isEqualTo(7_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isZero();
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 8)).totalExpenseWon())
                .isEqualTo(3_000);

        assertThatThrownBy(() -> transactionService.update(
                fixture.userId(), created.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, LocalDate.of(2026, 8, 2), 4_000,
                        medical, cash.assetId(), null, null, fixture.memberId(),
                        "오래된 수정", created.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));

        TransactionService.DeletedTransactionView deleted = transactionService.delete(
                fixture.userId(), created.transactionId(), updated.version());
        assertThat(deleted.deletedVersion()).isEqualTo(updated.version() + 1);
        assertThat(assetService.asset(fixture.userId(), cash.assetId()).currentBalanceWon())
                .isEqualTo(10_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 8)).totalExpenseWon())
                .isZero();
        assertThat(count("select count(*) from transaction_posting where transaction_id = ?",
                created.transactionId())).isOne();
        assertThatThrownBy(() -> transactionService.transaction(fixture.userId(), created.transactionId()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("TRANSACTION_NOT_FOUND"));
    }

    @Test
    void generalExpenseCanBeCorrectedFromBankToCreditCardPurchase() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "잘못 선택한 계좌", 100_000, "expense-to-card-bank");
        AssetService.AssetView card = assetService.create(
                fixture.userId(), "expense-to-card",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "CREDIT_CARD"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "실제 결제 카드", LocalDate.of(2026, 7, 1), null, 0,
                        new AssetService.CardSettingsCommand(
                                14, 25, 1, bank.assetId(), false)));
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        TransactionService.TransactionView accountExpense = transactionService.create(
                fixture.userId(), "expense-before-card-correction",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), 10_000, food, bank.assetId(),
                        fixture.memberId(), "계좌로 잘못 기록", 1));

        TransactionService.TransactionView cardPurchase = transactionService.update(
                fixture.userId(), accountExpense.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, LocalDate.of(2026, 7, 21), 30_000,
                        food, card.assetId(), null, null, fixture.memberId(),
                        "신용카드로 정정", accountExpense.version(), false, 3));

        assertThat(cardPurchase.managementType())
                .isEqualTo(TransactionService.TransactionManagementType.CARD_PURCHASE);
        assertThat(cardPurchase.installmentCount()).isEqualTo(3);
        assertThat(cardPurchase.version()).isEqualTo(accountExpense.version() + 1);
        assertThat(cardPurchase.postings()).singleElement().satisfies(posting -> {
            assertThat(posting.assetId()).isEqualTo(card.assetId());
            assertThat(posting.deltaWon()).isEqualTo(-30_000);
        });
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(100_000);
        assertThat(assetService.asset(fixture.userId(), card.assetId()).currentBalanceWon())
                .isEqualTo(-30_000);
        assertThat(count("select count(*) from card_purchase_billing_snapshot where purchase_transaction_id = ?",
                accountExpense.transactionId())).isOne();
        assertThat(count("select count(*) from card_charge where source_transaction_id = ?",
                accountExpense.transactionId())).isEqualTo(3);
        assertThat(queryLong("select sum(principal_amount_won) from card_charge where source_transaction_id = ?",
                accountExpense.transactionId())).isEqualTo(30_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isEqualTo(30_000);
    }

    @Test
    void debitExpenseKeepsItsHistoricalPostingAccountWhenTheCardSettingChanges() {
        Fixture fixture = fixture();
        AssetService.AssetView firstBank = createStandardAsset(
                fixture, "BANK", "첫 계좌", 100_000, "history-first-bank");
        AssetService.AssetView secondBank = createStandardAsset(
                fixture, "BANK", "둘째 계좌", 100_000, "history-second-bank");
        AssetService.AssetView debitCard = assetService.create(
                fixture.userId(), "history-debit-card",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "DEBIT_CARD"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "결제 체크카드", LocalDate.of(2026, 7, 1), null, 0,
                        null, new AssetService.DebitCardSettingsCommand(firstBank.assetId()), null));
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        TransactionService.TransactionView created = transactionService.create(
                fixture.userId(), "history-debit-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 10), 10_000, food, debitCard.assetId(),
                        fixture.memberId(), "체크 지출", 1));
        jdbcTemplate.update(
                "update debit_card_setting set payment_asset_id = ? where debit_card_asset_id = ?",
                secondBank.assetId(), debitCard.assetId());

        TransactionService.TransactionView updated = transactionService.update(
                fixture.userId(), created.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, LocalDate.of(2026, 7, 10), 12_000,
                        food, debitCard.assetId(), null, null, fixture.memberId(),
                        "금액 정정", created.version()));

        assertThat(updated.postings()).singleElement().satisfies(posting -> {
            assertThat(posting.assetId()).isEqualTo(firstBank.assetId());
            assertThat(posting.deltaWon()).isEqualTo(-12_000);
        });
        assertThat(assetService.asset(fixture.userId(), firstBank.assetId()).currentBalanceWon())
                .isEqualTo(88_000);
        assertThat(assetService.asset(fixture.userId(), secondBank.assetId()).currentBalanceWon())
                .isEqualTo(100_000);
    }

    @Test
    void normalTransferUpdateAndDeleteKeepTwoSidedPostingAndStayOutOfStatistics() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "이체 계좌", 100_000, "transfer-update-bank");
        AssetService.AssetView secondBank = createStandardAsset(
                fixture, "BANK", "이체 보조 계좌", 0, "transfer-update-second-bank");
        TransactionService.TransactionView created = transactionService.create(
                fixture.userId(), "transfer-update",
                new TransactionService.CreateTransfer(
                        LocalDate.of(2026, 7, 10), 20_000, bank.assetId(), secondBank.assetId(),
                        fixture.memberId(), "첫 이체"));

        TransactionService.TransactionView updated = transactionService.update(
                fixture.userId(), created.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.TRANSFER, LocalDate.of(2026, 7, 11), 30_000,
                        null, null, secondBank.assetId(), bank.assetId(), fixture.memberId(),
                        "반대 이체", created.version()));

        assertThat(updated.postings()).extracting(TransactionService.PostingView::deltaWon)
                .containsExactly(-30_000L, 30_000L);
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(130_000);
        assertThat(assetService.asset(fixture.userId(), secondBank.assetId()).currentBalanceWon())
                .isEqualTo(-30_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalIncomeWon())
                .isZero();
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isZero();

        transactionService.delete(fixture.userId(), created.transactionId(), updated.version());
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(100_000);
        assertThat(assetService.asset(fixture.userId(), secondBank.assetId()).currentBalanceWon())
                .isZero();
    }

    @Test
    void cardPurchaseCannotUseGeneralUpdateOrDeleteCommands() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "카드 계좌", 100_000, "blocked-card-bank");
        AssetService.AssetView card = assetService.create(
                fixture.userId(), "blocked-card",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "CREDIT_CARD"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "구매 신용카드", LocalDate.of(2026, 7, 1), null, 0,
                        new AssetService.CardSettingsCommand(
                                14, 25, 1, bank.assetId(), false)));
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        TransactionService.TransactionView purchase = transactionService.create(
                fixture.userId(), "blocked-card-purchase",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), 30_000, food, card.assetId(),
                        fixture.memberId(), "카드 구매", 1));
        long charges = count("select count(*) from card_charge where source_transaction_id = ?",
                purchase.transactionId());

        assertThat(purchase.managementType()).isEqualTo(
                TransactionService.TransactionManagementType.CARD_PURCHASE);
        assertThatThrownBy(() -> transactionService.update(
                fixture.userId(), purchase.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE, purchase.occurredOn(), 25_000, food,
                        card.assetId(), null, null, fixture.memberId(), "수정", purchase.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_PURCHASE_CORRECTION_REQUIRED"));
        assertThatThrownBy(() -> transactionService.delete(
                fixture.userId(), purchase.transactionId(), purchase.version()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_PURCHASE_CORRECTION_REQUIRED"));
        assertThat(count("select count(*) from card_charge where source_transaction_id = ?",
                purchase.transactionId())).isEqualTo(charges);
        assertThat(transactionService.transaction(fixture.userId(), purchase.transactionId()).amountWon())
                .isEqualTo(30_000);
    }

    @Test
    void concurrentUpdateAndDeleteWithTheSameVersionAllowOnlyOneCommand() throws Exception {
        Fixture fixture = fixture();
        AssetService.AssetView bank = createStandardAsset(
                fixture, "BANK", "경쟁 계좌", 100_000, "transaction-race-bank");
        UUID food = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        TransactionService.TransactionView created = transactionService.create(
                fixture.userId(), "transaction-race-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 10), 10_000, food, bank.assetId(),
                        fixture.memberId(), "경쟁 거래", 1));
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<String> update = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    transactionService.update(
                            fixture.userId(), created.transactionId(),
                            new TransactionService.UpdateCommand(
                                    TransactionType.EXPENSE, created.occurredOn(), 20_000,
                                    food, bank.assetId(), null, null, fixture.memberId(),
                                    "수정 승자", created.version()));
                    return "UPDATED";
                } catch (ApiException exception) {
                    return exception.getErrorCode();
                }
            });
            Future<String> delete = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    transactionService.delete(
                            fixture.userId(), created.transactionId(), created.version());
                    return "DELETED";
                } catch (ApiException exception) {
                    return exception.getErrorCode();
                }
            });
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<String> results = List.of(
                    update.get(10, TimeUnit.SECONDS), delete.get(10, TimeUnit.SECONDS));
            assertThat(results).filteredOn(result -> result.equals("UPDATED") || result.equals("DELETED"))
                    .hasSize(1);
            assertThat(results).filteredOn(result -> result.equals("VERSION_CONFLICT")
                            || result.equals("TRANSACTION_NOT_FOUND"))
                    .hasSize(1);
        } finally {
            executor.shutdownNow();
        }

        boolean deleted = count("select count(*) from ledger_transaction where id = ? and deleted_at is not null",
                created.transactionId()) == 1;
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(deleted ? 100_000 : 80_000);
        assertThat(count("select count(*) from transaction_posting where transaction_id = ?",
                created.transactionId())).isOne();
    }

    @Test
    void concurrentTransactionCreationAndAssetRemovalCannotBothCommit() throws Exception {
        Fixture fixture = fixture();
        AssetService.AssetView cash = createStandardAsset(
                fixture, "CASH", "삭제 경쟁 현금", 0, "asset-removal-race-cash");
        UUID incomeCategory = category(fixture.userId(), CategoryKind.INCOME, "OTHER");
        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                fixture.userId(), cash.assetId());
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<String> transaction = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    transactionService.create(
                            fixture.userId(), "asset-removal-race-income",
                            new TransactionService.CreateIncome(
                                    LocalDate.of(2026, 7, 18), 10_000, incomeCategory,
                                    cash.assetId(), fixture.memberId(), "삭제 경쟁 수입"));
                    return "TRANSACTION_CREATED";
                } catch (ApiException exception) {
                    return exception.getErrorCode();
                }
            });
            Future<String> removal = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    assetService.remove(
                            fixture.userId(), cash.assetId(),
                            preview.expectedVersion(), preview.previewToken());
                    return "REMOVED";
                } catch (ApiException exception) {
                    return exception.getErrorCode();
                }
            });
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<String> results = List.of(
                    transaction.get(10, TimeUnit.SECONDS), removal.get(10, TimeUnit.SECONDS));

            assertThat(results).filteredOn(result -> result.equals("TRANSACTION_CREATED")
                            || result.equals("REMOVED"))
                    .hasSize(1);
            assertThat(results).filteredOn(result -> result.equals("TRANSACTION_ASSET_INVALID")
                            || result.equals("ASSET_REMOVAL_PREVIEW_STALE"))
                    .hasSize(1);
        } finally {
            executor.shutdownNow();
        }

        long assetCount = count("select count(*) from asset where id = ?", cash.assetId());
        long transactionCount = count("""
                select count(*) from ledger_transaction
                 where primary_asset_id = ? and source_type = 'MANUAL'
                """, cash.assetId());
        assertThat(assetCount).isEqualTo(transactionCount);
        assertThat(assetCount).isIn(0L, 1L);
    }

    @Test
    void archivedAssetKeepsHistoricalTransactionAndCalendarStatistics() {
        Fixture fixture = fixture();
        AssetService.AssetView cash = createStandardAsset(
                fixture, "CASH", "과거 통계 현금", 0, "archived-statistics-cash");
        UUID expenseCategory = category(fixture.userId(), CategoryKind.EXPENSE, "FOOD");
        TransactionService.TransactionView expense = transactionService.create(
                fixture.userId(), "archived-statistics-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 18), 23_000, expenseCategory,
                        cash.assetId(), fixture.memberId(), "보관 후에도 보이는 지출", 1));
        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                fixture.userId(), cash.assetId());

        assetService.remove(
                fixture.userId(), cash.assetId(), preview.expectedVersion(), preview.previewToken());

        assertThat(assetService.asset(fixture.userId(), cash.assetId()).status())
                .isEqualTo(AssetService.AssetStatus.ARCHIVED);
        assertThat(transactionService.transaction(fixture.userId(), expense.transactionId()).asset().assetId())
                .isEqualTo(cash.assetId());
        TransactionService.CalendarView calendar = transactionService.calendar(
                fixture.userId(), YearMonth.of(2026, 7));
        assertThat(calendar.totalExpenseWon()).isEqualTo(23_000);
        assertThat(calendar.netWon()).isEqualTo(-23_000);
    }

    private Fixture fixture() {
        UUID userId = createUser("작성자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(userId);
        UUID memberId = book.members().stream().filter(MembershipService.LedgerMemberView::currentUser)
                .findFirst().orElseThrow().memberId();
        return new Fixture(userId, book.ledgerId(), memberId);
    }

    private AssetService.AssetView createStandardAsset(
            Fixture fixture, String systemCode, String name, long openingBalanceWon, String key
    ) {
        return assetService.create(fixture.userId(), key, new AssetService.AssetCommand(
                assetType(fixture.userId(), systemCode), AssetOwnershipScope.PERSONAL,
                fixture.memberId(), name, LocalDate.of(2026, 7, 1), null, openingBalanceWon, null));
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
        jdbcTemplate.update("insert into ledger_member (id, book_id, user_id, joined_at) values (?, ?, ?, now())",
                memberId, bookId, userId);
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
                """, userId, displayName, userId + "@transaction.test", now, now, now);
        return userId;
    }

    private long count(String sql, UUID id) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class, id);
        return value == null ? 0 : value;
    }

    private long queryLong(String sql, UUID id) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class, id);
        return value == null ? 0 : value;
    }

    private record Fixture(UUID userId, UUID bookId, UUID memberId) {
    }
}
