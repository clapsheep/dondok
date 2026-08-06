package com.dondok.transaction.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.category.application.CategoryService;
import com.dondok.category.domain.CategoryKind;
import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
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
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import(CardPurchaseManagementServiceIntegrationTest.FixedClockConfiguration.class)
class CardPurchaseManagementServiceIntegrationTest {
    @Autowired private CardPurchaseManagementService managementService;
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
    void unpaidPartialRefundOffsetsExpenseAndSupportsReplayRepeatAndExcessGuard() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "unpaid-purchase");

        CardPurchaseManagementService.CardPurchaseRefundPreview preview = managementService.previewRefund(
                fixture.userId(), purchase.transactionId(), new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 7, 22), 40_000, purchase.version(), "부분 환불"));
        assertThat(preview.unpaidCardReductionWon()).isEqualTo(40_000);
        assertThat(preview.accountReturns()).isEmpty();

        CardPurchaseManagementService.RefundApplyCommand command =
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 7, 22), 40_000, purchase.version(),
                        "부분 환불", preview.previewToken());
        CardPurchaseManagementService.CardPurchaseRefundResult result = managementService.refund(
                fixture.userId(), purchase.transactionId(), "refund-unpaid", command);
        CardPurchaseManagementService.CardPurchaseRefundResult replay = managementService.refund(
                fixture.userId(), purchase.transactionId(), "refund-unpaid", command);

        assertThat(replay.refundTransaction().transactionId())
                .isEqualTo(result.refundTransaction().transactionId());
        assertThat(result.refundTransaction().managementType())
                .isEqualTo(TransactionService.TransactionManagementType.CARD_REFUND);
        assertThat(result.refundTransaction().relatedPurchaseTransactionId())
                .isEqualTo(purchase.transactionId());
        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-60_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isEqualTo(60_000);
        assertThat(forecast(purchase.transactionId())).isEqualTo(60_000);

        CardPurchaseManagementService.CardPurchaseManagementView current = managementService.management(
                fixture.userId(), purchase.transactionId());
        assertThat(current.refundableAmountWon()).isEqualTo(60_000);
        assertThat(current.refunds()).hasSize(1);
        assertThatThrownBy(() -> managementService.previewRefund(
                fixture.userId(), purchase.transactionId(), new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 7, 23), 60_001, current.purchase().version(), null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_REFUND_AMOUNT_EXCEEDED"));

        CardPurchaseManagementService.CardPurchaseRefundPreview secondPreview =
                managementService.previewRefund(
                        fixture.userId(), purchase.transactionId(),
                        new CardPurchaseManagementService.RefundCommand(
                                LocalDate.of(2026, 7, 23), 10_000,
                                current.purchase().version(), null));
        managementService.refund(fixture.userId(), purchase.transactionId(), "refund-unpaid-second",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 7, 23), 10_000, current.purchase().version(),
                        null, secondPreview.previewToken()));
        assertThat(managementService.management(fixture.userId(), purchase.transactionId()).refunds())
                .hasSize(2);
    }

    @Test
    void cardCorrectionAndRefundCanStayOutOfAggregatesWithoutChangingTheirPostings() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "excluded-card-purchase");
        CardPurchaseManagementService.CorrectionCommand correction =
                new CardPurchaseManagementService.CorrectionCommand(
                        purchase.occurredOn(), purchase.amountWon(), purchase.category().categoryId(),
                        fixture.card().assetId(), fixture.memberId(), purchase.description(), 1,
                        purchase.version(), true);
        CardPurchaseManagementService.CardPurchaseCorrectionPreview correctionPreview =
                managementService.previewCorrection(
                        fixture.userId(), purchase.transactionId(), correction);
        CardPurchaseManagementService.CardPurchaseManagementView corrected = managementService.correct(
                fixture.userId(), purchase.transactionId(), "excluded-card-correction",
                new CardPurchaseManagementService.CorrectionApplyCommand(
                        correction.occurredOn(), correction.amountWon(), correction.categoryId(),
                        correction.cardAssetId(), correction.performedByMemberId(),
                        correction.description(), correction.installmentCount(),
                        correction.expectedVersion(), correctionPreview.previewToken(), true));

        assertThat(corrected.purchase().excludedFromStatistics()).isTrue();
        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-100_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isZero();

        CardPurchaseManagementService.RefundCommand refund =
                new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 7, 22), 40_000,
                        corrected.purchase().version(), "집계 제외 환불", true);
        CardPurchaseManagementService.CardPurchaseRefundPreview refundPreview =
                managementService.previewRefund(fixture.userId(), purchase.transactionId(), refund);
        CardPurchaseManagementService.CardPurchaseRefundResult result = managementService.refund(
                fixture.userId(), purchase.transactionId(), "excluded-card-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        refund.refundedOn(), refund.amountWon(), refund.expectedVersion(),
                        refund.description(), refundPreview.previewToken(), true));

        assertThat(result.refundTransaction().excludedFromStatistics()).isTrue();
        assertThat(managementService.management(fixture.userId(), purchase.transactionId()).refunds())
                .singleElement()
                .extracting(CardPurchaseManagementService.CardRefundView::excludedFromStatistics)
                .isEqualTo(true);
        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-60_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isZero();
    }

    @Test
    void refundAfterAnchorReducesTheAnchoredCardBalanceAndItsPaymentDue() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "anchor-absorbed-purchase");
        AssetService.CardSettingsCommand cardSettings = new AssetService.CardSettingsCommand(
                14, 25, 1, fixture.bank().assetId(), false);
        assetService.update(fixture.userId(), fixture.card().assetId(),
                new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                assetType(fixture.userId(), "CREDIT_CARD"),
                                AssetOwnershipScope.PERSONAL, fixture.memberId(),
                                fixture.card().name(), LocalDate.of(2026, 7, 21), null,
                                -100_000, cardSettings),
                        fixture.card().version(), false));

        CardPurchaseManagementService.CardPurchaseRefundPreview preview = managementService.previewRefund(
                fixture.userId(), purchase.transactionId(),
                new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 7, 22), 40_000, purchase.version(), "기준일 이후 환불"));

        assertThat(preview.unpaidCardReductionWon()).isEqualTo(40_000);
        managementService.refund(
                fixture.userId(), purchase.transactionId(), "anchor-absorbed-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 7, 22), 40_000, purchase.version(),
                        "기준일 이후 환불", preview.previewToken()));

        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-60_000);
        assertThat(queryLong("""
                select coalesce(sum(forecast.payment_amount_won), 0)
                  from card_statement_forecast forecast
                 where forecast.card_asset_id = ?
                   and forecast.status in ('OPEN', 'FINALIZED')
                """, fixture.card().assetId())).isEqualTo(60_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isEqualTo(60_000);
    }

    @Test
    void refundAfterPaidAnchorReturnsMoneyToTheActualPaymentAccount() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "paid-anchor-absorbed-purchase");
        insertPayment(fixture, statementId(purchase.transactionId()), fixture.bank().assetId(),
                fixture.card().assetId(), 100_000, LocalDate.of(2026, 8, 21));
        AssetService.CardSettingsCommand cardSettings = new AssetService.CardSettingsCommand(
                14, 25, 1, fixture.bank().assetId(), false);
        assetService.update(fixture.userId(), fixture.card().assetId(),
                new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                assetType(fixture.userId(), "CREDIT_CARD"),
                                AssetOwnershipScope.PERSONAL, fixture.memberId(),
                                fixture.card().name(), LocalDate.of(2026, 8, 20), null,
                                -100_000, cardSettings),
                        fixture.card().version(), false));

        CardPurchaseManagementService.CardPurchaseRefundPreview preview = managementService.previewRefund(
                fixture.userId(), purchase.transactionId(),
                new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 8, 22), 40_000, purchase.version(), null));

        assertThat(preview.unpaidCardReductionWon()).isZero();
        assertThat(preview.accountReturns())
                .extracting(
                        CardPurchaseManagementService.AccountReturnView::assetId,
                        CardPurchaseManagementService.AccountReturnView::amountWon)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(
                        fixture.bank().assetId(), 40_000L));
        managementService.refund(
                fixture.userId(), purchase.transactionId(), "paid-anchor-absorbed-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 8, 22), 40_000, purchase.version(),
                        null, preview.previewToken()));

        assertThat(assetBalance(fixture.card().assetId())).isZero();
        assertThat(assetBalance(fixture.bank().assetId())).isEqualTo(440_000);
        assertThat(queryLong("""
                select coalesce(sum(forecast.payment_amount_won), 0)
                  from card_statement_forecast forecast
                 where forecast.card_asset_id = ?
                """, fixture.card().assetId())).isZero();
    }

    @Test
    void mixedRefundUsesStatementUnpaidThenLatestActualPaymentAccountWithOtherPurchasePresent() {
        Fixture fixture = fixture();
        AssetService.AssetView secondBank = createStandardAsset(
                fixture, "두 번째 결제 계좌", 500_000, "mixed-second-bank");
        TransactionService.TransactionView target = purchase(fixture, 100_000, "mixed-target");
        purchase(fixture, 100_000, "mixed-other");
        UUID statementId = statementId(target.transactionId());
        insertPayment(fixture, statementId, fixture.bank().assetId(), fixture.card().assetId(),
                120_000, LocalDate.of(2026, 8, 25));
        insertPayment(fixture, statementId, secondBank.assetId(), fixture.card().assetId(),
                30_000, LocalDate.of(2026, 8, 26));

        CardPurchaseManagementService.CardPurchaseRefundPreview preview = managementService.previewRefund(
                fixture.userId(), target.transactionId(), new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 8, 27), 100_000, target.version(), null));

        assertThat(preview.unpaidCardReductionWon()).isEqualTo(50_000);
        assertThat(preview.accountReturns())
                .extracting(
                        CardPurchaseManagementService.AccountReturnView::assetId,
                        CardPurchaseManagementService.AccountReturnView::amountWon)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(secondBank.assetId(), 30_000L),
                        org.assertj.core.groups.Tuple.tuple(fixture.bank().assetId(), 20_000L));
        managementService.refund(fixture.userId(), target.transactionId(), "mixed-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 8, 27), 100_000, target.version(),
                        null, preview.previewToken()));

        assertThat(forecast(target.transactionId())).isZero();
        assertThat(assetBalance(fixture.card().assetId())).isZero();
        assertThat(assetBalance(secondBank.assetId())).isEqualTo(500_000);
        assertThat(assetBalance(fixture.bank().assetId())).isEqualTo(400_000);
        assertThat(queryLong("""
                select sum(allocation.amount_won)
                  from card_purchase_refund_payment allocation
                  join card_statement_payment payment on payment.id = allocation.statement_payment_id
                 where payment.settlement_asset_id = ?
                """, secondBank.assetId())).isEqualTo(30_000);
        assertThat(queryLong("""
                select sum(allocation.amount_won)
                  from card_purchase_refund_payment allocation
                  join card_statement_payment payment on payment.id = allocation.statement_payment_id
                 where payment.settlement_asset_id = ?
                """, fixture.bank().assetId())).isEqualTo(20_000);
    }

    @Test
    void correctionRebuildsOpenPurchaseAndReducesOnlyStatementPaymentExcessLatestFirst() {
        Fixture fixture = fixture();
        AssetService.AssetView secondBank = createStandardAsset(
                fixture, "정정 두 번째 계좌", 500_000, "correction-second-bank");
        TransactionService.TransactionView target = purchase(fixture, 100_000, "correction-target");
        purchase(fixture, 100_000, "correction-other");
        UUID statementId = statementId(target.transactionId());
        UUID firstPayment = insertPayment(fixture, statementId, fixture.bank().assetId(),
                fixture.card().assetId(), 80_000, LocalDate.of(2026, 8, 25));
        UUID latestPayment = insertPayment(fixture, statementId, secondBank.assetId(),
                fixture.card().assetId(), 70_000, LocalDate.of(2026, 8, 26));

        CardPurchaseManagementService.CorrectionCommand previewCommand =
                new CardPurchaseManagementService.CorrectionCommand(
                        target.occurredOn(), 20_000, target.category().categoryId(),
                        fixture.card().assetId(), fixture.memberId(), "금액 정정", 1, target.version());
        CardPurchaseManagementService.CardPurchaseCorrectionPreview preview =
                managementService.previewCorrection(fixture.userId(), target.transactionId(), previewCommand);

        assertThat(preview.accountReturns()).singleElement().satisfies(account -> {
            assertThat(account.assetId()).isEqualTo(secondBank.assetId());
            assertThat(account.amountWon()).isEqualTo(30_000);
        });
        CardPurchaseManagementService.CardPurchaseManagementView corrected = managementService.correct(
                fixture.userId(), target.transactionId(), "paid-correction",
                new CardPurchaseManagementService.CorrectionApplyCommand(
                        target.occurredOn(), 20_000, target.category().categoryId(),
                        fixture.card().assetId(), fixture.memberId(), "금액 정정", 1,
                        target.version(), preview.previewToken()));

        assertThat(corrected.purchase().amountWon()).isEqualTo(20_000);
        assertThat(corrected.purchase().version()).isEqualTo(target.version() + 1);
        assertThat(paymentAmount(firstPayment)).isEqualTo(80_000);
        assertThat(paymentAmount(latestPayment)).isEqualTo(40_000);
        assertThat(assetBalance(fixture.card().assetId())).isZero();
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isEqualTo(120_000);
        assertThat(forecast(target.transactionId())).isZero();
    }

    @Test
    void stalePreviewAndCrossLedgerAreRejectedAndArchivedOriginalAccountStillReceivesReturn() {
        Fixture fixture = fixture();
        Fixture other = fixture();
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "stale-purchase");
        UUID statementId = statementId(purchase.transactionId());
        insertPayment(fixture, statementId, fixture.bank().assetId(), fixture.card().assetId(),
                100_000, LocalDate.of(2026, 8, 25));
        CardPurchaseManagementService.CardPurchaseRefundPreview preview = managementService.previewRefund(
                fixture.userId(), purchase.transactionId(), new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 8, 27), 50_000, purchase.version(), null));

        insertPayment(fixture, statementId, fixture.bank().assetId(), fixture.card().assetId(),
                1, LocalDate.of(2026, 8, 26));
        assertThatThrownBy(() -> managementService.refund(
                fixture.userId(), purchase.transactionId(), "stale-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 8, 27), 50_000, purchase.version(),
                        null, preview.previewToken())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_PURCHASE_PREVIEW_STALE"));
        assertThatThrownBy(() -> managementService.management(
                other.userId(), purchase.transactionId()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_PURCHASE_NOT_FOUND"));

        jdbcTemplate.update("""
                update asset set archived_at = now(), archived_by_member_id = ?
                 where id = ?
                """, fixture.memberId(), fixture.bank().assetId());
        CardPurchaseManagementService.CardPurchaseRefundPreview archivedPreview =
                managementService.previewRefund(
                        fixture.userId(), purchase.transactionId(),
                        new CardPurchaseManagementService.RefundCommand(
                                LocalDate.of(2026, 8, 28), 50_000, purchase.version(), null));
        assertThat(archivedPreview.accountReturns()).singleElement()
                .extracting(CardPurchaseManagementService.AccountReturnView::assetId)
                .isEqualTo(fixture.bank().assetId());
        CardPurchaseManagementService.CardPurchaseRefundResult archivedResult =
                managementService.refund(
                        fixture.userId(), purchase.transactionId(), "archived-account-refund",
                        new CardPurchaseManagementService.RefundApplyCommand(
                                LocalDate.of(2026, 8, 28), 50_000, purchase.version(), null,
                                archivedPreview.previewToken()));
        assertThat(archivedResult.accountReturns()).singleElement()
                .extracting(CardPurchaseManagementService.AccountReturnView::assetId)
                .isEqualTo(fixture.bank().assetId());
        assertThat(assetBalance(fixture.bank().assetId())).isEqualTo(449_999);
    }

    @Test
    void correctionCanMovePaidPurchaseToAnotherCardAndRestoresOriginalSettlementAccount() {
        Fixture fixture = fixture();
        AssetService.AssetView secondCard = createCard(
                fixture, fixture.bank().assetId(), "정정 대상 카드", "correction-target-card");
        TransactionService.TransactionView purchase = purchase(fixture, 100_000, "move-card-purchase");
        UUID statementId = statementId(purchase.transactionId());
        insertPayment(fixture, statementId, fixture.bank().assetId(), fixture.card().assetId(),
                100_000, LocalDate.of(2026, 8, 25));

        CardPurchaseManagementService.CorrectionCommand command =
                new CardPurchaseManagementService.CorrectionCommand(
                        LocalDate.of(2026, 8, 3), 60_000, purchase.category().categoryId(),
                        secondCard.assetId(), fixture.memberId(), "카드와 날짜 정정", 2,
                        purchase.version());
        CardPurchaseManagementService.CardPurchaseCorrectionPreview preview =
                managementService.previewCorrection(fixture.userId(), purchase.transactionId(), command);

        assertThat(preview.accountReturns()).singleElement().satisfies(account -> {
            assertThat(account.assetId()).isEqualTo(fixture.bank().assetId());
            assertThat(account.amountWon()).isEqualTo(100_000);
        });
        CardPurchaseManagementService.CardPurchaseManagementView corrected = managementService.correct(
                fixture.userId(), purchase.transactionId(), "move-card-correction",
                new CardPurchaseManagementService.CorrectionApplyCommand(
                        command.occurredOn(), command.amountWon(), command.categoryId(),
                        command.cardAssetId(), command.performedByMemberId(), command.description(),
                        command.installmentCount(), command.expectedVersion(), preview.previewToken()));

        assertThat(corrected.billingSnapshot().cardAssetId()).isEqualTo(secondCard.assetId());
        assertThat(corrected.billingSnapshot().installmentCount()).isEqualTo(2);
        assertThat(corrected.charges()).extracting(
                        CardPurchaseManagementService.CardChargeView::principalAmountWon)
                .containsExactly(30_000L, 30_000L);
        assertThat(assetBalance(fixture.card().assetId())).isZero();
        assertThat(assetBalance(secondCard.assetId())).isEqualTo(-60_000);
        assertThat(assetBalance(fixture.bank().assetId())).isEqualTo(500_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isZero();
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 8)).totalExpenseWon())
                .isEqualTo(60_000);
    }

    @Test
    void correctionPreservesAndRedistributesHistoricalPartialRefunds() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "historical-refund-purchase");
        CardPurchaseManagementService.CardPurchaseRefundPreview refundPreview =
                managementService.previewRefund(
                        fixture.userId(), purchase.transactionId(),
                        new CardPurchaseManagementService.RefundCommand(
                                LocalDate.of(2026, 7, 22), 30_000, purchase.version(), null));
        managementService.refund(fixture.userId(), purchase.transactionId(), "historical-refund",
                new CardPurchaseManagementService.RefundApplyCommand(
                        LocalDate.of(2026, 7, 22), 30_000, purchase.version(), null,
                        refundPreview.previewToken()));
        CardPurchaseManagementService.CardPurchaseManagementView afterRefund =
                managementService.management(fixture.userId(), purchase.transactionId());

        CardPurchaseManagementService.CorrectionCommand command =
                new CardPurchaseManagementService.CorrectionCommand(
                        LocalDate.of(2026, 7, 21), 80_000, purchase.category().categoryId(),
                        fixture.card().assetId(), fixture.memberId(), "환불 후 정정", 2,
                        afterRefund.purchase().version());
        CardPurchaseManagementService.CardPurchaseCorrectionPreview correctionPreview =
                managementService.previewCorrection(fixture.userId(), purchase.transactionId(), command);
        CardPurchaseManagementService.CorrectionApplyCommand apply =
                new CardPurchaseManagementService.CorrectionApplyCommand(
                        command.occurredOn(), command.amountWon(), command.categoryId(),
                        command.cardAssetId(), command.performedByMemberId(), command.description(),
                        command.installmentCount(), command.expectedVersion(),
                        correctionPreview.previewToken());
        CardPurchaseManagementService.CardPurchaseManagementView corrected = managementService.correct(
                fixture.userId(), purchase.transactionId(), "historical-refund-correction", apply);
        CardPurchaseManagementService.CardPurchaseManagementView replay = managementService.correct(
                fixture.userId(), purchase.transactionId(), "historical-refund-correction", apply);

        assertThat(replay.purchase().version()).isEqualTo(corrected.purchase().version());
        assertThat(corrected.purchase().amountWon()).isEqualTo(80_000);
        assertThat(corrected.refundableAmountWon()).isEqualTo(50_000);
        assertThat(corrected.refunds()).singleElement()
                .extracting(CardPurchaseManagementService.CardRefundView::amountWon)
                .isEqualTo(30_000L);
        assertThat(corrected.charges()).extracting(
                        CardPurchaseManagementService.CardChargeView::refundedAmountWon)
                .containsExactlyInAnyOrder(0L, 30_000L);
        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-50_000);
        assertThat(totalForecast(purchase.transactionId())).isEqualTo(50_000);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isEqualTo(50_000);
    }

    @Test
    void concurrentPartialRefundsWithSamePurchaseVersionAllowOnlyOneCommit() throws Exception {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "refund-race-purchase");
        CardPurchaseManagementService.RefundCommand previewCommand =
                new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 7, 22), 60_000, purchase.version(), null);
        CardPurchaseManagementService.CardPurchaseRefundPreview preview =
                managementService.previewRefund(
                        fixture.userId(), purchase.transactionId(), previewCommand);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<String>> requests = List.of("race-refund-a", "race-refund-b").stream()
                    .map(key -> executor.submit(() -> {
                        ready.countDown();
                        start.await();
                        try {
                            managementService.refund(
                                    fixture.userId(), purchase.transactionId(), key,
                                    new CardPurchaseManagementService.RefundApplyCommand(
                                            previewCommand.refundedOn(), previewCommand.amountWon(),
                                            previewCommand.expectedVersion(), null,
                                            preview.previewToken()));
                            return "CREATED";
                        } catch (ApiException exception) {
                            return exception.getErrorCode();
                        }
                    })).toList();
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<String> results = List.of(
                    requests.get(0).get(10, TimeUnit.SECONDS),
                    requests.get(1).get(10, TimeUnit.SECONDS));
            assertThat(results).filteredOn("CREATED"::equals).hasSize(1);
            assertThat(results).filteredOn("VERSION_CONFLICT"::equals).hasSize(1);
        } finally {
            executor.shutdownNow();
        }
        CardPurchaseManagementService.CardPurchaseManagementView current =
                managementService.management(fixture.userId(), purchase.transactionId());
        assertThat(current.refunds()).hasSize(1);
        assertThat(current.refundableAmountWon()).isEqualTo(40_000);
        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-40_000);
    }

    @Test
    void concurrentRetryWithSameIdempotencyKeyReturnsOneRefund() throws Exception {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "same-key-refund-purchase");
        CardPurchaseManagementService.RefundCommand previewCommand =
                new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 7, 22), 50_000, purchase.version(), null);
        CardPurchaseManagementService.CardPurchaseRefundPreview preview =
                managementService.previewRefund(
                        fixture.userId(), purchase.transactionId(), previewCommand);
        CardPurchaseManagementService.RefundApplyCommand command =
                new CardPurchaseManagementService.RefundApplyCommand(
                        previewCommand.refundedOn(), previewCommand.amountWon(),
                        previewCommand.expectedVersion(), null, preview.previewToken());
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<UUID>> requests = List.of(0, 1).stream()
                    .map(ignored -> executor.submit(() -> {
                        ready.countDown();
                        start.await();
                        return managementService.refund(
                                fixture.userId(), purchase.transactionId(),
                                "same-concurrent-refund-key", command)
                                .refundTransaction().transactionId();
                    })).toList();
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<UUID> transactionIds = List.of(
                    requests.get(0).get(10, TimeUnit.SECONDS),
                    requests.get(1).get(10, TimeUnit.SECONDS));
            assertThat(transactionIds).allMatch(transactionIds.get(0)::equals);
        } finally {
            executor.shutdownNow();
        }
        assertThat(managementService.management(fixture.userId(), purchase.transactionId()).refunds())
                .hasSize(1);
    }

    @Test
    void increasingPaidStatementBeforeDueDateReopensItAsOpenWithOnlyTheNewRemainderDue() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "increase-paid-purchase");
        UUID statementId = statementId(purchase.transactionId());
        insertPayment(fixture, statementId, fixture.bank().assetId(), fixture.card().assetId(),
                100_000, LocalDate.of(2026, 8, 25));
        jdbcTemplate.update("""
                update card_statement
                   set status = 'PAID', billed_amount_won = 100000,
                       finalized_at = now(), settled_at = now()
                 where id = ?
                """, statementId);

        CardPurchaseManagementService.CorrectionCommand command =
                new CardPurchaseManagementService.CorrectionCommand(
                        purchase.occurredOn(), 120_000, purchase.category().categoryId(),
                        fixture.card().assetId(), fixture.memberId(), "결제 후 증액", 1,
                        purchase.version());
        CardPurchaseManagementService.CardPurchaseCorrectionPreview preview =
                managementService.previewCorrection(fixture.userId(), purchase.transactionId(), command);
        managementService.correct(
                fixture.userId(), purchase.transactionId(), "increase-paid-correction",
                new CardPurchaseManagementService.CorrectionApplyCommand(
                        command.occurredOn(), command.amountWon(), command.categoryId(),
                        command.cardAssetId(), command.performedByMemberId(), command.description(),
                        command.installmentCount(), command.expectedVersion(), preview.previewToken()));

        assertThat(jdbcTemplate.queryForObject(
                "select status from card_statement where id = ?", String.class, statementId))
                .isEqualTo("OPEN");
        assertThat(forecast(purchase.transactionId())).isEqualTo(20_000);
        assertThat(assetBalance(fixture.card().assetId())).isEqualTo(-20_000);
    }

    @Test
    void databaseFailureDuringRefundAllocationRollsBackEveryEarlierWrite() {
        Fixture fixture = fixture();
        TransactionService.TransactionView purchase = purchase(
                fixture, 100_000, "rollback-refund-purchase");
        UUID statementId = statementId(purchase.transactionId());
        insertPayment(fixture, statementId, fixture.bank().assetId(), fixture.card().assetId(),
                100_000, LocalDate.of(2026, 8, 25));
        CardPurchaseManagementService.RefundCommand previewCommand =
                new CardPurchaseManagementService.RefundCommand(
                        LocalDate.of(2026, 8, 27), 50_000, purchase.version(), null);
        CardPurchaseManagementService.CardPurchaseRefundPreview preview =
                managementService.previewRefund(
                        fixture.userId(), purchase.transactionId(), previewCommand);
        jdbcTemplate.execute("""
                create function dondok_test_fail_refund_payment()
                returns trigger language plpgsql as $$
                begin
                    raise exception 'forced refund allocation failure';
                end
                $$
                """);
        jdbcTemplate.execute("""
                create trigger dondok_test_fail_refund_payment_trigger
                before insert on card_purchase_refund_payment
                for each row execute function dondok_test_fail_refund_payment()
                """);
        try {
            assertThatThrownBy(() -> managementService.refund(
                    fixture.userId(), purchase.transactionId(), "rollback-refund",
                    new CardPurchaseManagementService.RefundApplyCommand(
                            previewCommand.refundedOn(), previewCommand.amountWon(),
                            previewCommand.expectedVersion(), null, preview.previewToken())))
                    .isInstanceOf(DataAccessException.class);
        } finally {
            jdbcTemplate.execute("""
                    drop trigger if exists dondok_test_fail_refund_payment_trigger
                    on card_purchase_refund_payment
                    """);
            jdbcTemplate.execute("drop function if exists dondok_test_fail_refund_payment()");
        }

        assertThat(managementService.management(fixture.userId(), purchase.transactionId()).refunds())
                .isEmpty();
        assertThat(transactionService.transaction(fixture.userId(), purchase.transactionId()).version())
                .isEqualTo(purchase.version());
        assertThat(queryLong("""
                select count(*) from ledger_transaction
                 where book_id = ? and source_type = 'CARD_REFUND'
                """, fixture.bookId())).isZero();
        assertThat(queryLong("""
                select count(*) from api_idempotency
                 where book_id = ? and idempotency_key = 'rollback-refund'
                """, fixture.bookId())).isZero();
        assertThat(assetBalance(fixture.card().assetId())).isZero();
        assertThat(assetBalance(fixture.bank().assetId())).isEqualTo(400_000);
    }

    private Fixture fixture() {
        UUID userId = createUser("카드 관리 작성자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(userId);
        UUID memberId = book.members().stream().filter(MembershipService.LedgerMemberView::currentUser)
                .findFirst().orElseThrow().memberId();
        Fixture bare = new Fixture(userId, book.ledgerId(), memberId, null, null);
        AssetService.AssetView bank = createStandardAsset(
                bare, "카드 결제 계좌", 500_000, "management-bank-" + userId);
        AssetService.AssetView card = createCard(
                bare, bank.assetId(), "관리 신용카드", "management-card-" + userId);
        return new Fixture(userId, book.ledgerId(), memberId, bank, card);
    }

    private AssetService.AssetView createCard(
            Fixture fixture,
            UUID settlementAssetId,
            String name,
            String key
    ) {
        return assetService.create(
                fixture.userId(), key,
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "CREDIT_CARD"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), name, LocalDate.of(2026, 7, 1), null, 0,
                        new AssetService.CardSettingsCommand(
                                14, 25, 1, settlementAssetId, false)));
    }

    private TransactionService.TransactionView purchase(Fixture fixture, long amountWon, String key) {
        return transactionService.create(
                fixture.userId(), key, new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 20), amountWon,
                        category(fixture.userId(), CategoryKind.EXPENSE, "FOOD"),
                        fixture.card().assetId(), fixture.memberId(), key, 1));
    }

    private AssetService.AssetView createStandardAsset(
            Fixture fixture, String name, long openingBalanceWon, String key
    ) {
        return assetService.create(fixture.userId(), key, new AssetService.AssetCommand(
                assetType(fixture.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                fixture.memberId(), name, LocalDate.of(2026, 7, 1), null, openingBalanceWon, null));
    }

    private UUID insertPayment(
            Fixture fixture,
            UUID statementId,
            UUID settlementAssetId,
            UUID cardAssetId,
            long amountWon,
            LocalDate paidOn
    ) {
        UUID paymentId = UUID.randomUUID();
        UUID transactionId = UUID.randomUUID();
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, transfer_subtype, occurred_on, amount_won,
                    category_id, performed_by_member_id, primary_asset_id, description,
                    source_type, source_id, created_by_member_id, updated_by_member_id,
                    created_at, updated_at, version
                ) values (?, ?, 'TRANSFER', 'CARD_PREPAYMENT', ?, ?, null, null, null,
                          'test payment', 'CARD_PREPAYMENT', ?, ?, ?, ?, ?, 0)
                """, transactionId, fixture.bookId(), Date.valueOf(paidOn), amountWon,
                paymentId, fixture.memberId(), fixture.memberId(), now, now);
        jdbcTemplate.update("""
                insert into transaction_posting (
                    transaction_id, line_no, book_id, asset_id, delta_won
                ) values (?, 1, ?, ?, ?), (?, 2, ?, ?, ?)
                """, transactionId, fixture.bookId(), settlementAssetId, -amountWon,
                transactionId, fixture.bookId(), cardAssetId, amountWon);
        jdbcTemplate.update("""
                insert into card_statement_payment (
                    id, book_id, statement_id, payment_type, settlement_asset_id,
                    amount_won, paid_on, settlement_transaction_id,
                    created_by_member_id, created_at
                ) values (?, ?, ?, 'PREPAYMENT', ?, ?, ?, ?, ?, ?)
                """, paymentId, fixture.bookId(), statementId, settlementAssetId,
                amountWon, Date.valueOf(paidOn), transactionId, fixture.memberId(), now);
        return paymentId;
    }

    private UUID statementId(UUID purchaseId) {
        return jdbcTemplate.queryForObject(
                "select statement_id from card_charge where source_transaction_id = ?",
                UUID.class, purchaseId);
    }

    private long forecast(UUID purchaseId) {
        return queryLong("""
                select forecast.payment_amount_won
                  from card_statement_forecast forecast
                  join card_charge charge on charge.statement_id = forecast.statement_id
                 where charge.source_transaction_id = ?
                 limit 1
                """, purchaseId);
    }

    private long totalForecast(UUID purchaseId) {
        return queryLong("""
                select sum(forecast.payment_amount_won)
                  from card_statement_forecast forecast
                 where forecast.statement_id in (
                     select charge.statement_id from card_charge charge
                      where charge.source_transaction_id = ?
                 )
                """, purchaseId);
    }

    private long paymentAmount(UUID paymentId) {
        return queryLong("select amount_won from card_statement_payment where id = ?", paymentId);
    }

    private long assetBalance(UUID assetId) {
        return queryLong("select current_balance_won from asset_current_balance where asset_id = ?", assetId);
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
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into app_user (
                    id, display_name, email, status, email_verified_at,
                    locale, time_zone, created_at, updated_at, version
                ) values (?, ?, ?, 'ACTIVE', ?, 'ko-KR', 'Asia/Seoul', ?, ?, 0)
                """, userId, displayName, userId + "@card-management.test", now, now, now);
        return userId;
    }

    private long queryLong(String sql, UUID id) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class, id);
        return value == null ? 0 : value;
    }

    private record Fixture(
            UUID userId,
            UUID bookId,
            UUID memberId,
            AssetService.AssetView bank,
            AssetService.AssetView card
    ) {
    }

    @TestConfiguration
    static class FixedClockConfiguration {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-07-18T03:00:00Z"), ZoneOffset.UTC);
        }
    }
}
