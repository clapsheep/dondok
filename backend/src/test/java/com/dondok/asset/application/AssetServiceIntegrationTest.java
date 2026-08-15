package com.dondok.asset.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.asset.domain.AssetBehavior;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.asset.domain.CardIssuerCode;
import com.dondok.asset.domain.FinancialInstitutionCode;
import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import(AssetServiceIntegrationTest.FixedClockConfiguration.class)
class AssetServiceIntegrationTest {

    private static final Instant FIXED_NOW = Instant.parse("2026-07-31T15:30:00Z");

    @Autowired
    private AssetService assetService;

    @Autowired
    private MembershipService membershipService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final List<UUID> testUsers = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        for (UUID userId : testUsers) {
            jdbcTemplate.update("delete from ledger_book where created_by_user_id = ?", userId);
        }
        for (UUID userId : testUsers) {
            jdbcTemplate.update("delete from app_user where id = ?", userId);
        }
        jdbcTemplate.update("delete from korean_public_holiday where source = 'ASSET_TEST'");
    }

    @Test
    void ledgerCreationSeedsTypesAndIdempotentAssetCreationWritesOpeningPosting() {
        TestLedger ledger = createLedger("자산 생성자");

        assertThat(assetService.assetTypes(ledger.userId()))
                .extracting(AssetService.AssetTypeView::systemCode)
                .containsExactly(
                        "CASH", "BANK", "CREDIT_CARD", "DEBIT_CARD", "SAVINGS",
                        "INVESTMENT", "LOAN", "INSURANCE", "OTHER");

        UUID bankTypeId = typeId(ledger.userId(), "BANK");
        AssetService.AssetCommand command = command(
                bankTypeId, AssetOwnershipScope.JOINT, null,
                "공동 생활비 계좌", 1_250_000, null);

        AssetService.AssetView created = assetService.create(
                ledger.userId(), "same-bank-request", command);
        AssetService.AssetView replayed = assetService.create(
                ledger.userId(), "same-bank-request", command);

        assertThat(replayed.assetId()).isEqualTo(created.assetId());
        assertThat(created.currentBalanceWon()).isEqualTo(1_250_000);
        assertThat(created.openingBalanceWon()).isEqualTo(1_250_000);
        assertThat(created.ownershipScope()).isEqualTo(AssetOwnershipScope.JOINT);
        assertThat(created.ownerMemberId()).isNull();
        assertThat(count("select count(*) from asset where book_id = ?", ledger.bookId())).isEqualTo(5);
        assertThat(count("select count(*) from ledger_transaction where book_id = ? and source_type = 'OPENING_BALANCE'",
                ledger.bookId())).isOne();
        assertThat(jdbcTemplate.queryForObject(
                "select delta_won from transaction_posting where asset_id = ?", Long.class, created.assetId()))
                .isEqualTo(1_250_000L);
    }

    @Test
    void financialInstitutionsAndCardIssuersAreStoredOnlyForTheirAssetFamilies() {
        TestLedger ledger = createLedger("금융기관 사용자");

        AssetService.AssetView defaultAccount = assetService.assets(ledger.userId()).stream()
                .filter(asset -> "BANK".equals(asset.systemCode()))
                .findFirst()
                .orElseThrow();
        assertThat(defaultAccount.financialInstitutionCode()).isEqualTo(FinancialInstitutionCode.OTHER);

        AssetService.AssetView savings = assetService.create(
                ledger.userId(), "kakao-savings",
                new AssetService.AssetCommand(
                        typeId(ledger.userId(), "SAVINGS"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), FinancialInstitutionCode.KAKAO_BANK,
                        "여행 적금", LocalDate.of(2026, 7, 1), null, 500_000,
                        null, null, null));

        assertThat(savings.financialInstitutionCode()).isEqualTo(FinancialInstitutionCode.KAKAO_BANK);
        assertThat(jdbcTemplate.queryForObject(
                "select financial_institution_code from asset where id = ?", String.class, savings.assetId()))
                .isEqualTo("KAKAO_BANK");

        AssetService.AssetView loan = assetService.create(
                ledger.userId(), "kb-capital-loan",
                new AssetService.AssetCommand(
                        typeId(ledger.userId(), "LOAN"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), FinancialInstitutionCode.KB_CAPITAL,
                        "자동차 대출", LocalDate.of(2026, 7, 1), null, -20_000_000,
                        null, null, null));
        AssetService.AssetView investment = assetService.create(
                ledger.userId(), "kiwoom-investment",
                new AssetService.AssetCommand(
                        typeId(ledger.userId(), "INVESTMENT"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), FinancialInstitutionCode.KIWOOM_SEC,
                        "주식 계좌", LocalDate.of(2026, 7, 1), null, 3_000_000,
                        null, null, null));

        assertThat(loan.financialInstitutionCode()).isEqualTo(FinancialInstitutionCode.KB_CAPITAL);
        assertThat(investment.financialInstitutionCode()).isEqualTo(FinancialInstitutionCode.KIWOOM_SEC);
        assertThatThrownBy(() -> assetService.create(
                ledger.userId(), "wrong-investment-institution",
                new AssetService.AssetCommand(
                        typeId(ledger.userId(), "INVESTMENT"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), FinancialInstitutionCode.KB_CAPITAL,
                        "잘못된 투자 기관", LocalDate.of(2026, 7, 1), null, 0,
                        null, null, null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("FINANCIAL_INSTITUTION_INVALID"));

        AssetService.AssetView defaultCard = assetService.assets(ledger.userId()).stream()
                .filter(asset -> "CREDIT_CARD".equals(asset.systemCode()))
                .findFirst()
                .orElseThrow();
        assertThat(defaultCard.cardIssuerCode()).isEqualTo(CardIssuerCode.OTHER);

        AssetService.AssetView shinhanCard = assetService.create(
                ledger.userId(), "shinhan-card",
                new AssetService.AssetCommand(
                        typeId(ledger.userId(), "CREDIT_CARD"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), null, CardIssuerCode.SHINHAN,
                        "신한카드", LocalDate.of(2026, 7, 1), null, 0,
                        new AssetService.CardSettingsCommand(14, 25, 1, defaultAccount.assetId(), false),
                        null, null));

        assertThat(shinhanCard.cardIssuerCode()).isEqualTo(CardIssuerCode.SHINHAN);
        assertThat(shinhanCard.financialInstitutionCode()).isNull();
        assertThat(jdbcTemplate.queryForObject(
                "select card_issuer_code from asset where id = ?", String.class, shinhanCard.assetId()))
                .isEqualTo("SHINHAN");
    }

    @Test
    void assetViewsBatchMonthlyTotalsAndTwoNearestCardPaymentDues() {
        TestLedger ledger = createLedger("두 달 카드 예정액 사용자");
        List<AssetService.AssetView> initialAssets = assetService.assets(ledger.userId());
        AssetService.AssetView account = initialAssets.stream()
                .filter(asset -> "BANK".equals(asset.systemCode()))
                .findFirst()
                .orElseThrow();
        AssetService.AssetView defaultCard = initialAssets.stream()
                .filter(asset -> "CREDIT_CARD".equals(asset.systemCode()))
                .findFirst()
                .orElseThrow();
        AssetService.AssetView secondCard = assetService.create(
                ledger.userId(), "second-card-for-monthly-due",
                command(typeId(ledger.userId(), "CREDIT_CARD"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "두 번째 카드", 0,
                        new AssetService.CardSettingsCommand(14, 25, 1, account.assetId(), false)));

        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 15),
                LocalDate.of(2026, 7, 31), "FINALIZED", 40_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 7, 16), LocalDate.of(2026, 7, 20),
                LocalDate.of(2026, 8, 1), "FINALIZED", 10_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 7, 21), LocalDate.of(2026, 7, 22),
                LocalDate.of(2026, 8, 1), "FINALIZED", 5_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 15),
                LocalDate.of(2026, 8, 31), "FINALIZED", 20_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 8, 16), LocalDate.of(2026, 8, 20),
                LocalDate.of(2026, 9, 1), "FINALIZED", 80_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 8, 23), LocalDate.of(2026, 8, 25),
                LocalDate.of(2026, 9, 30), "FINALIZED", 20_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 15),
                LocalDate.of(2026, 10, 1), "FINALIZED", 320_000);
        insertStatement(ledger, defaultCard.assetId(),
                LocalDate.of(2026, 8, 21), LocalDate.of(2026, 8, 22),
                LocalDate.of(2026, 8, 25), "PAID", 160_000);
        insertStatement(ledger, secondCard.assetId(),
                LocalDate.of(2026, 7, 20), LocalDate.of(2026, 7, 25),
                LocalDate.of(2026, 8, 5), "FINALIZED", 50_000);
        insertStatement(ledger, secondCard.assetId(),
                LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 10),
                LocalDate.of(2026, 9, 5), "FINALIZED", 60_000);

        List<AssetService.AssetView> assets = assetService.assets(ledger.userId());
        AssetService.AssetView defaultCardView = asset(assets, defaultCard.assetId());
        AssetService.AssetView secondCardView = asset(assets, secondCard.assetId());
        AssetService.AssetView accountView = asset(assets, account.assetId());

        assertThat(defaultCardView.systemCode()).isEqualTo("CREDIT_CARD");
        assertThat(defaultCardView.currentMonthCardPaymentDueWon()).isEqualTo(35_000);
        assertThat(defaultCardView.nextMonthCardPaymentDueWon()).isEqualTo(100_000);
        assertThat(defaultCardView.nearestCardPaymentDueOn()).isEqualTo(LocalDate.of(2026, 7, 31));
        assertThat(defaultCardView.nearestCardPaymentDueWon()).isEqualTo(40_000);
        assertThat(defaultCardView.followingCardPaymentDueOn()).isEqualTo(LocalDate.of(2026, 8, 1));
        assertThat(defaultCardView.followingCardPaymentDueWon()).isEqualTo(15_000);
        assertThat(secondCardView.systemCode()).isEqualTo("CREDIT_CARD");
        assertThat(secondCardView.currentMonthCardPaymentDueWon()).isEqualTo(50_000);
        assertThat(secondCardView.nextMonthCardPaymentDueWon()).isEqualTo(60_000);
        assertThat(secondCardView.nearestCardPaymentDueOn()).isEqualTo(LocalDate.of(2026, 8, 5));
        assertThat(secondCardView.nearestCardPaymentDueWon()).isEqualTo(50_000);
        assertThat(secondCardView.followingCardPaymentDueOn()).isEqualTo(LocalDate.of(2026, 9, 5));
        assertThat(secondCardView.followingCardPaymentDueWon()).isEqualTo(60_000);
        assertThat(accountView.systemCode()).isEqualTo("BANK");
        assertThat(accountView.currentMonthCardPaymentDueWon()).isZero();
        assertThat(accountView.nextMonthCardPaymentDueWon()).isZero();
        assertThat(accountView.nearestCardPaymentDueOn()).isNull();
        assertThat(accountView.nearestCardPaymentDueWon()).isZero();
        assertThat(accountView.followingCardPaymentDueOn()).isNull();
        assertThat(accountView.followingCardPaymentDueWon()).isZero();
        AssetService.AssetView defaultCardDetail = assetService.asset(ledger.userId(), defaultCard.assetId());
        assertThat(defaultCardDetail.currentMonthCardPaymentDueWon()).isEqualTo(35_000);
        assertThat(defaultCardDetail.nextMonthCardPaymentDueWon()).isEqualTo(100_000);
        assertThat(defaultCardDetail.nearestCardPaymentDueOn()).isEqualTo(LocalDate.of(2026, 7, 31));
        assertThat(defaultCardDetail.followingCardPaymentDueOn()).isEqualTo(LocalDate.of(2026, 8, 1));
        AssetService.AssetView accountDetail = assetService.asset(ledger.userId(), account.assetId());
        assertThat(accountDetail.currentMonthCardPaymentDueWon()).isZero();
        assertThat(accountDetail.nextMonthCardPaymentDueWon()).isZero();
        assertThat(accountDetail.nearestCardPaymentDueOn()).isNull();
        assertThat(accountDetail.followingCardPaymentDueOn()).isNull();
    }

    @Test
    void cardSettlementAssetIsRequiredEvenWhenAutoSettlementIsDisabled() {
        TestLedger ledger = createLedger("카드 결제 계좌 필수 검증");
        UUID cardTypeId = typeId(ledger.userId(), "CREDIT_CARD");
        AssetService.CardSettingsCommand cardSettings = new AssetService.CardSettingsCommand(
                14, 25, 1, null, false);

        assertThatThrownBy(() -> assetService.create(
                ledger.userId(), "card-without-settlement-asset",
                command(cardTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "결제 계좌 없는 카드", 0, cardSettings)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CARD_SETTLEMENT_ASSET_INVALID"));

        assertThat(count("select count(*) from asset where book_id = ?", ledger.bookId())).isEqualTo(4);
    }

    @Test
    void cardSettlementAssetIsSavedWhenAutoSettlementIsDisabled() {
        TestLedger ledger = createLedger("수동 카드 결제 설정");
        UUID bankTypeId = typeId(ledger.userId(), "BANK");
        UUID cardTypeId = typeId(ledger.userId(), "CREDIT_CARD");
        AssetService.AssetView bank = assetService.create(
                ledger.userId(), "manual-settlement-bank",
                command(bankTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "수동 결제 계좌", 500_000, null));
        AssetService.CardSettingsCommand cardSettings = new AssetService.CardSettingsCommand(
                14, 25, 1, bank.assetId(), false);

        AssetService.AssetView card = assetService.create(
                ledger.userId(), "manual-settlement-card",
                command(cardTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "수동 결제 카드", 0, cardSettings));

        assertThat(card.cardSettings()).isNotNull();
        assertThat(card.cardSettings().settlementAssetId()).isEqualTo(bank.assetId());
        assertThat(card.cardSettings().autoSettlementEnabled()).isFalse();
        assertThat(jdbcTemplate.queryForObject(
                "select settlement_asset_id from card_setting where card_asset_id = ?",
                UUID.class, card.assetId())).isEqualTo(bank.assetId());
        assertThat(jdbcTemplate.queryForObject(
                "select auto_settlement_enabled from card_setting where card_asset_id = ?",
                Boolean.class, card.assetId())).isFalse();
    }

    @Test
    void linkedDefaultAccountCannotBecomeANonPaymentSourceType() {
        TestLedger ledger = createLedger("기본 계좌 연결 보호");
        AssetService.AssetView defaultAccount = assetService.assets(ledger.userId()).stream()
                .filter(asset -> asset.name().equals("계좌"))
                .findFirst()
                .orElseThrow();
        UUID cashTypeId = typeId(ledger.userId(), "CASH");

        assertThatThrownBy(() -> assetService.update(
                ledger.userId(),
                defaultAccount.assetId(),
                new AssetService.UpdateAssetCommand(
                        command(cashTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                                "계좌", 0, null),
                        defaultAccount.version(),
                        false)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("ASSET_LINKED_AS_PAYMENT_SOURCE"));

        assertThat(assetService.asset(ledger.userId(), defaultAccount.assetId()).assetTypeName())
                .isEqualTo("계좌");
        assertThat(count("select count(*) from card_setting where settlement_asset_id = ?",
                defaultAccount.assetId())).isOne();
        assertThat(count("select count(*) from debit_card_setting where payment_asset_id = ?",
                defaultAccount.assetId())).isOne();
    }

    @Test
    void debitCardRequiresItsLinkedAccountAndSavingsAutoTransferIsOptional() {
        TestLedger ledger = createLedger("연결 계좌 설정 사용자");
        UUID bankTypeId = typeId(ledger.userId(), "BANK");
        UUID debitTypeId = typeId(ledger.userId(), "DEBIT_CARD");
        UUID savingsTypeId = typeId(ledger.userId(), "SAVINGS");
        AssetService.AssetView bank = assetService.create(
                ledger.userId(), "linked-setting-bank",
                command(bankTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "생활비 계좌", 1_000_000, null));

        assertThatThrownBy(() -> assetService.create(
                ledger.userId(), "debit-without-payment-account",
                new AssetService.AssetCommand(
                        debitTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "설정 없는 체크카드", LocalDate.of(2026, 7, 15), null, 0,
                        null, null, null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("DEBIT_CARD_SETTINGS_REQUIRED"));

        AssetService.AssetView debitCard = assetService.create(
                ledger.userId(), "debit-with-payment-account",
                new AssetService.AssetCommand(
                        debitTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "생활 체크카드", LocalDate.of(2026, 7, 15), null, 0,
                        null, new AssetService.DebitCardSettingsCommand(bank.assetId()), null));
        AssetService.AssetView savings = assetService.create(
                ledger.userId(), "savings-with-transfer-account",
                new AssetService.AssetCommand(
                        savingsTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "적금", LocalDate.of(2026, 7, 16), null, 300_000,
                        null, null, new AssetService.SavingsSettingsCommand(bank.assetId(), 20)));
        AssetService.AssetView savingsWithoutAutoTransfer = assetService.create(
                ledger.userId(), "savings-without-transfer-account",
                new AssetService.AssetCommand(
                        savingsTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "자유 적금", LocalDate.of(2026, 7, 17), null, 150_000,
                        null, null, null));

        assertThat(debitCard.behavior()).isEqualTo(AssetBehavior.DEBIT_CARD);
        assertThat(debitCard.debitCardSettings().paymentAssetId()).isEqualTo(bank.assetId());
        assertThat(savings.behavior()).isEqualTo(AssetBehavior.SAVINGS);
        assertThat(savings.savingsSettings().transferAssetId()).isEqualTo(bank.assetId());
        assertThat(savings.savingsSettings().transferDay()).isEqualTo(20);
        assertThat(savingsWithoutAutoTransfer.savingsSettings()).isNull();
        assertThat(jdbcTemplate.queryForObject(
                "select payment_asset_id from debit_card_setting where debit_card_asset_id = ?",
                UUID.class, debitCard.assetId())).isEqualTo(bank.assetId());
        assertThat(jdbcTemplate.queryForObject(
                "select transfer_day from savings_setting where savings_asset_id = ?",
                Integer.class, savings.assetId())).isEqualTo(20);
        assertThat(count("select count(*) from savings_setting where savings_asset_id = ?",
                savingsWithoutAutoTransfer.assetId())).isZero();

        AssetService.AssetView savingsWithDisabledAutoTransfer = assetService.update(
                ledger.userId(), savings.assetId(), new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                savingsTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                                "적금", LocalDate.of(2026, 7, 16), null, 300_000,
                                null, null, null),
                        savings.version(), false));

        assertThat(savingsWithDisabledAutoTransfer.savingsSettings()).isNull();
        assertThat(savingsWithDisabledAutoTransfer.currentBalanceWon()).isEqualTo(300_000);
        assertThat(count("select count(*) from savings_setting where savings_asset_id = ?",
                savings.assetId())).isZero();
    }

    @Test
    void negativeCardOpeningCreatesAndUpdatesOneBusinessDayAdjustedStatement() {
        TestLedger ledger = createLedger("카드 생성자");
        UUID bankTypeId = typeId(ledger.userId(), "BANK");
        UUID cardTypeId = typeId(ledger.userId(), "CREDIT_CARD");
        AssetService.AssetView bank = assetService.create(
                ledger.userId(), "settlement-bank",
                command(bankTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "결제 계좌", 300_000, null));
        jdbcTemplate.update("""
                insert into korean_public_holiday (holiday_on, name, source)
                values ('2026-08-17', '대체 휴일 테스트', 'ASSET_TEST')
                """);

        AssetService.CardSettingsCommand cardSettings = new AssetService.CardSettingsCommand(
                15, 15, 1, bank.assetId(), true);
        AssetService.AssetView card = assetService.create(
                ledger.userId(), "opening-card",
                new AssetService.AssetCommand(
                        cardTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "생활비 카드", LocalDate.of(2026, 7, 10), null, -180_000, cardSettings));

        assertThat(card.currentBalanceWon()).isEqualTo(-180_000);
        assertThat(card.cardSettings()).isNotNull();
        assertThat(jdbcTemplate.queryForObject(
                "select due_on from card_statement where card_asset_id = ?", LocalDate.class, card.assetId()))
                .isEqualTo(LocalDate.of(2026, 8, 18));
        assertThat(jdbcTemplate.queryForObject(
                "select billed_amount_won from card_statement where card_asset_id = ?", Long.class, card.assetId()))
                .isEqualTo(180_000L);
        assertThat(jdbcTemplate.queryForObject(
                "select principal_amount_won from card_charge where card_asset_id = ? and charge_origin = 'OPENING_BALANCE'",
                Long.class, card.assetId())).isEqualTo(180_000L);
        assertThat(jdbcTemplate.queryForObject(
                "select settlement_asset_id from card_payment_schedule where book_id = ?",
                UUID.class, ledger.bookId())).isEqualTo(bank.assetId());

        AssetService.AssetView updated = assetService.update(
                ledger.userId(), card.assetId(), new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                cardTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                                "생활비 카드", LocalDate.of(2026, 7, 10), "수정됨", -220_000, cardSettings),
                        card.version(), false));

        assertThat(updated.currentBalanceWon()).isEqualTo(-220_000);
        assertThat(count("select count(*) from card_charge where card_asset_id = ?", card.assetId())).isOne();
        assertThat(jdbcTemplate.queryForObject(
                "select billed_amount_won from card_statement where card_asset_id = ?", Long.class, card.assetId()))
                .isEqualTo(220_000L);

        assertThatThrownBy(() -> assetService.update(
                ledger.userId(), card.assetId(), new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                cardTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                                "오래된 수정", LocalDate.of(2026, 7, 10), null, -10_000, cardSettings),
                        card.version(), false)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
    }

    @Test
    void fixedSystemTypesUseConfirmedNamesAndBehavior() {
        TestLedger ledger = createLedger("고정 자산 종류 사용자");
        List<AssetService.AssetTypeView> types = assetService.assetTypes(ledger.userId());

        assertThat(types).hasSize(9);
        assertThat(types).noneMatch(type -> "OVERDRAFT".equals(type.systemCode()));
        assertThat(types).filteredOn(type -> "BANK".equals(type.systemCode()))
                .singleElement().extracting(AssetService.AssetTypeView::name).isEqualTo("계좌");
        assertThat(types).filteredOn(type -> "SAVINGS".equals(type.systemCode()))
                .singleElement().extracting(AssetService.AssetTypeView::name).isEqualTo("적금");
        assertThat(types).filteredOn(type -> "OTHER".equals(type.systemCode()))
                .singleElement().satisfies(other -> {
                    assertThat(other.name()).isEqualTo("기타");
                    assertThat(other.behavior()).isEqualTo(AssetBehavior.STANDARD);
                    assertThat(other.paymentSourceCapable()).isFalse();
                });

        UUID otherTypeId = typeId(ledger.userId(), "OTHER");
        AssetService.AssetView other = assetService.create(
                ledger.userId(), "fixed-other-type",
                command(otherTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "여행 지갑", 50_000, null));

        assertThat(other.assetTypeId()).isEqualTo(otherTypeId);
        assertThat(other.assetTypeName()).isEqualTo("기타");
        assertThat(other.behavior()).isEqualTo(AssetBehavior.STANDARD);
        assertThat(other.paymentSourceCapable()).isFalse();
        assertThatThrownBy(() -> assetService.create(
                ledger.userId(), "unknown-asset-type",
                command(UUID.randomUUID(), AssetOwnershipScope.PERSONAL, ledger.memberId(),
                        "알 수 없는 종류", 0, null)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("ASSET_TYPE_INVALID"));
    }

    @Test
    void assetWithoutAnyLedgerHistoryIsPhysicallyDeleted() {
        TestLedger ledger = createLedger("무이력 자산 삭제 사용자");
        AssetService.AssetView cash = assetService.create(
                ledger.userId(), "remove-empty-cash",
                command(typeId(ledger.userId(), "CASH"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "빈 지갑", 0, null));

        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                ledger.userId(), cash.assetId());
        assertThat(preview.disposition()).isEqualTo(AssetService.AssetRemovalDisposition.DELETE);
        assertThat(preview.historyTransactionCount()).isZero();
        assertThat(preview.previewToken()).hasSize(64);

        AssetService.AssetRemovalResult result = assetService.remove(
                ledger.userId(), cash.assetId(), preview.expectedVersion(), preview.previewToken());

        assertThat(result.disposition()).isEqualTo(AssetService.AssetRemovalResultDisposition.DELETED);
        assertThat(count("select count(*) from asset where id = ?", cash.assetId())).isZero();
        assertThatThrownBy(() -> assetService.asset(ledger.userId(), cash.assetId()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("ASSET_NOT_FOUND"));
    }

    @Test
    void assetWithOnlyDeclaredOpeningBalanceIsPhysicallyDeleted() {
        TestLedger ledger = createLedger("기준 잔액만 있는 자산 삭제 사용자");
        AssetService.AssetView loan = assetService.create(
                ledger.userId(), "remove-opening-only-loan",
                command(typeId(ledger.userId(), "LOAN"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "신한마이너스통장", -7_000_000, null));

        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                ledger.userId(), loan.assetId());

        assertThat(preview.disposition()).isEqualTo(AssetService.AssetRemovalDisposition.DELETE);
        assertThat(preview.historyTransactionCount()).isZero();
        AssetService.AssetRemovalResult result = assetService.remove(
                ledger.userId(), loan.assetId(), preview.expectedVersion(), preview.previewToken());
        assertThat(result.disposition()).isEqualTo(AssetService.AssetRemovalResultDisposition.DELETED);
        assertThat(count("select count(*) from asset where id = ?", loan.assetId())).isZero();
        assertThat(jdbcTemplate.queryForObject("""
                select count(*) from ledger_transaction
                 where book_id = ? and source_type = 'OPENING_BALANCE' and source_id = ?
                """, Long.class, ledger.bookId(), loan.assetId())).isZero();
    }

    @Test
    void assetWithHistoryIsArchivedAndRemainsAvailableInHistoryFilters() {
        TestLedger ledger = createLedger("이력 자산 보관 사용자");
        AssetService.AssetView cash = assetService.create(
                ledger.userId(), "archive-cash",
                command(typeId(ledger.userId(), "CASH"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "비상금", 0, null));
        UUID transactionId = UUID.randomUUID();
        UUID categoryId = jdbcTemplate.queryForObject("""
                select id from category
                 where book_id = ? and kind = 'INCOME' and system_code = 'OTHER'
                """, UUID.class, ledger.bookId());
        Timestamp now = Timestamp.from(FIXED_NOW);
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, occurred_on, amount_won, category_id,
                    performed_by_member_id, primary_asset_id, source_type,
                    created_by_member_id, updated_by_member_id, created_at, updated_at, version
                ) values (?, ?, 'INCOME', '2026-07-10', 120000, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, 0)
                """, transactionId, ledger.bookId(), categoryId, ledger.memberId(), cash.assetId(),
                ledger.memberId(), ledger.memberId(), now, now);
        jdbcTemplate.update("""
                insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
                values (?, 1, ?, ?, 120000)
                """, transactionId, ledger.bookId(), cash.assetId());

        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                ledger.userId(), cash.assetId());
        assertThat(preview.disposition()).isEqualTo(AssetService.AssetRemovalDisposition.ARCHIVE);
        assertThat(preview.historyTransactionCount()).isOne();
        assertThat(preview.currentBalanceWon()).isEqualTo(120_000);

        AssetService.AssetRemovalResult result = assetService.remove(
                ledger.userId(), cash.assetId(), preview.expectedVersion(), preview.previewToken());

        assertThat(result.disposition()).isEqualTo(AssetService.AssetRemovalResultDisposition.ARCHIVED);
        AssetService.AssetView detail = assetService.asset(ledger.userId(), cash.assetId());
        assertThat(detail.status()).isEqualTo(AssetService.AssetStatus.ARCHIVED);
        assertThat(detail.archivedAt()).isEqualTo(FIXED_NOW);
        assertThat(detail.currentBalanceWon()).isEqualTo(120_000);
        assertThat(assetService.assets(ledger.userId(), AssetService.AssetListStatus.ACTIVE))
                .extracting(AssetService.AssetView::assetId).doesNotContain(cash.assetId());
        assertThat(assetService.assets(ledger.userId(), AssetService.AssetListStatus.ARCHIVED))
                .extracting(AssetService.AssetView::assetId).containsExactly(cash.assetId());
        assertThat(assetService.assets(ledger.userId(), AssetService.AssetListStatus.ALL))
                .extracting(AssetService.AssetView::assetId).contains(cash.assetId());

        AssetService.AssetView restored = assetService.restore(
                ledger.userId(), cash.assetId(), detail.version());
        assertThat(restored.status()).isEqualTo(AssetService.AssetStatus.ACTIVE);
        assertThat(restored.archivedAt()).isNull();
        assertThat(restored.currentBalanceWon()).isEqualTo(120_000);
        assertThat(restored.version()).isEqualTo(detail.version() + 1);
        assertThat(assetService.assets(ledger.userId(), AssetService.AssetListStatus.ACTIVE))
                .extracting(AssetService.AssetView::assetId).contains(cash.assetId());
        assertThat(assetService.assets(ledger.userId(), AssetService.AssetListStatus.ARCHIVED))
                .extracting(AssetService.AssetView::assetId).doesNotContain(cash.assetId());
        assertThatThrownBy(() -> assetService.restore(
                ledger.userId(), cash.assetId(), restored.version()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("ASSET_ALREADY_ACTIVE"));
    }

    @Test
    void softDeletedPrimaryOnlyTransactionStillForcesArchive() {
        TestLedger ledger = createLedger("삭제 거래 이력 보관 사용자");
        List<AssetService.AssetView> seeded = assetService.assets(ledger.userId());
        AssetService.AssetView debit = seeded.stream()
                .filter(asset -> asset.behavior() == AssetBehavior.DEBIT_CARD).findFirst().orElseThrow();
        AssetService.AssetView account = seeded.stream()
                .filter(asset -> "BANK".equals(asset.systemCode())).findFirst().orElseThrow();
        UUID categoryId = jdbcTemplate.queryForObject("""
                select id from category
                 where book_id = ? and kind = 'EXPENSE' and system_code = 'FOOD'
                """, UUID.class, ledger.bookId());
        UUID transactionId = UUID.randomUUID();
        Timestamp now = Timestamp.from(FIXED_NOW);
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, occurred_on, amount_won, category_id,
                    performed_by_member_id, primary_asset_id, description, source_type,
                    created_by_member_id, updated_by_member_id, deleted_by_member_id,
                    created_at, updated_at, deleted_at, version
                ) values (?, ?, 'EXPENSE', '2026-07-10', 1000, ?, ?, ?, '삭제된 체크카드 거래',
                          'MANUAL', ?, ?, ?, ?, ?, ?, 1)
                """, transactionId, ledger.bookId(), categoryId, ledger.memberId(), debit.assetId(),
                ledger.memberId(), ledger.memberId(), ledger.memberId(), now, now, now);
        jdbcTemplate.update("""
                insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
                values (?, 1, ?, ?, -1000)
                """, transactionId, ledger.bookId(), account.assetId());

        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                ledger.userId(), debit.assetId());

        assertThat(preview.historyTransactionCount()).isOne();
        assertThat(preview.currentBalanceWon()).isZero();
        assertThat(preview.disposition()).isEqualTo(AssetService.AssetRemovalDisposition.ARCHIVE);
    }

    @Test
    void removalRejectsChangedHistoryAndOperationalPaymentSourceLinks() {
        TestLedger ledger = createLedger("자산 제거 경합 사용자");
        AssetService.AssetView cash = assetService.create(
                ledger.userId(), "stale-removal-cash",
                command(typeId(ledger.userId(), "CASH"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "변경될 지갑", 0, null));
        AssetService.AssetRemovalPreview stalePreview = assetService.removalPreview(
                ledger.userId(), cash.assetId());
        UUID transactionId = UUID.randomUUID();
        Timestamp now = Timestamp.from(FIXED_NOW);
        UUID categoryId = jdbcTemplate.queryForObject("""
                select id from category
                 where book_id = ? and kind = 'INCOME' and system_code = 'OTHER'
                """, UUID.class, ledger.bookId());
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, occurred_on, amount_won, category_id,
                    performed_by_member_id, primary_asset_id, source_type,
                    created_by_member_id, updated_by_member_id, created_at, updated_at, version
                ) values (?, ?, 'INCOME', '2026-07-01', 1, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, 0)
                """, transactionId, ledger.bookId(), categoryId, ledger.memberId(), cash.assetId(),
                ledger.memberId(), ledger.memberId(), now, now);
        jdbcTemplate.update("""
                insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
                values (?, 1, ?, ?, 1)
                """, transactionId, ledger.bookId(), cash.assetId());

        assertThatThrownBy(() -> assetService.remove(
                ledger.userId(), cash.assetId(), stalePreview.expectedVersion(), stalePreview.previewToken()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("ASSET_REMOVAL_PREVIEW_STALE"));

        AssetService.AssetView account = assetService.assets(ledger.userId()).stream()
                .filter(asset -> "BANK".equals(asset.systemCode())).findFirst().orElseThrow();
        AssetService.AssetRemovalPreview linkedPreview = assetService.removalPreview(
                ledger.userId(), account.assetId());
        assertThat(linkedPreview.blockingLinks())
                .extracting(AssetService.AssetRemovalBlockingLink::kind)
                .contains(AssetService.AssetRemovalBlockingLinkKind.CREDIT_CARD_SETTLEMENT,
                        AssetService.AssetRemovalBlockingLinkKind.DEBIT_CARD_PAYMENT);
        assertThatThrownBy(() -> assetService.remove(
                ledger.userId(), account.assetId(),
                linkedPreview.expectedVersion(), linkedPreview.previewToken()))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.getErrorCode()).isEqualTo("ASSET_LINKED_AS_PAYMENT_SOURCE");
                    assertThat(exception.getProperties()).containsKey("blockingLinks");
                });
    }

    @Test
    void inactiveArchivedLinkPreservesTargetByArchivingWithoutSilentlyUnlinking() {
        TestLedger ledger = createLedger("보관 연결 보존 사용자");
        AssetService.AssetView account = assetService.create(
                ledger.userId(), "retained-link-account",
                command(typeId(ledger.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "과거 연결 계좌", 0, null));
        AssetService.AssetView debit = assetService.create(
                ledger.userId(), "retained-link-debit",
                new AssetService.AssetCommand(
                        typeId(ledger.userId(), "DEBIT_CARD"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "보관 체크카드", LocalDate.of(2026, 7, 1), null, 0,
                        null, new AssetService.DebitCardSettingsCommand(account.assetId()), null));
        jdbcTemplate.update("""
                update asset
                   set archived_at = ?, archived_by_member_id = ?,
                       updated_by_member_id = ?, updated_at = ?, version = version + 1
                 where id = ? and book_id = ?
                """, Timestamp.from(FIXED_NOW), ledger.memberId(), ledger.memberId(),
                Timestamp.from(FIXED_NOW), debit.assetId(), ledger.bookId());

        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                ledger.userId(), account.assetId());

        assertThat(preview.blockingLinks()).isEmpty();
        assertThat(preview.historyTransactionCount()).isZero();
        assertThat(preview.disposition()).isEqualTo(AssetService.AssetRemovalDisposition.ARCHIVE);
        assetService.remove(
                ledger.userId(), account.assetId(), preview.expectedVersion(), preview.previewToken());
        assertThat(assetService.asset(ledger.userId(), account.assetId()).status())
                .isEqualTo(AssetService.AssetStatus.ARCHIVED);
        assertThat(count("select count(*) from debit_card_setting where payment_asset_id = ?",
                account.assetId())).isOne();
    }

    @Test
    void concurrentPaymentLinkCreationAndRemovalCannotBothCommit() throws Exception {
        TestLedger ledger = createLedger("연결 생성 제거 경합 사용자");
        AssetService.AssetView account = assetService.create(
                ledger.userId(), "link-removal-race-account",
                command(typeId(ledger.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        ledger.memberId(), "경합 계좌", 0, null));
        AssetService.AssetRemovalPreview preview = assetService.removalPreview(
                ledger.userId(), account.assetId());
        UUID debitTypeId = typeId(ledger.userId(), "DEBIT_CARD");

        List<Outcome> outcomes = runConcurrently(
                () -> {
                    try {
                        assetService.create(
                                ledger.userId(), "link-removal-race-debit",
                                new AssetService.AssetCommand(
                                        debitTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                                        "경합 체크카드", LocalDate.of(2026, 7, 1), null, 0,
                                        null, new AssetService.DebitCardSettingsCommand(account.assetId()), null));
                        return new Outcome(true, null);
                    } catch (ApiException exception) {
                        return new Outcome(false, exception.getErrorCode());
                    }
                },
                () -> {
                    try {
                        assetService.remove(
                                ledger.userId(), account.assetId(),
                                preview.expectedVersion(), preview.previewToken());
                        return new Outcome(true, null);
                    } catch (ApiException exception) {
                        return new Outcome(false, exception.getErrorCode());
                    }
                });

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .allMatch(code -> code.equals("DEBIT_CARD_PAYMENT_ASSET_INVALID")
                        || code.equals("ASSET_REMOVAL_PREVIEW_STALE"));
        long accountCount = count("select count(*) from asset where id = ?", account.assetId());
        long linkCount = count("select count(*) from debit_card_setting where payment_asset_id = ?",
                account.assetId());
        assertThat(accountCount).isEqualTo(linkCount);
        assertThat(accountCount).isIn(0L, 1L);
    }

    @Test
    void concurrentCreationCannotExceedFiftyActiveAssets() throws Exception {
        TestLedger ledger = createLedger("자산 한도 사용자");
        UUID cashTypeId = typeId(ledger.userId(), "CASH");
        for (int index = 0; index < 45; index++) {
            assetService.create(
                    ledger.userId(), "asset-limit-" + index,
                    command(cashTypeId, AssetOwnershipScope.PERSONAL, ledger.memberId(),
                            "현금 " + index, 0, null));
        }

        List<Outcome> outcomes = runConcurrently(
                () -> createAtLimit(ledger, cashTypeId, "동시 현금 A", "asset-limit-a"),
                () -> createAtLimit(ledger, cashTypeId, "동시 현금 B", "asset-limit-b"));

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .containsExactly("ASSET_LIMIT_EXCEEDED");
        assertThat(count("select count(*) from asset where book_id = ? and archived_at is null", ledger.bookId()))
                .isEqualTo(50);
    }

    private AssetService.AssetCommand command(
            UUID typeId,
            AssetOwnershipScope scope,
            UUID ownerMemberId,
            String name,
            long openingBalanceWon,
            AssetService.CardSettingsCommand cardSettings
    ) {
        return new AssetService.AssetCommand(
                typeId, scope, ownerMemberId, name,
                LocalDate.of(2026, 7, 1), null, openingBalanceWon, cardSettings);
    }

    private UUID typeId(UUID userId, String systemCode) {
        return assetService.assetTypes(userId).stream()
                .filter(type -> systemCode.equals(type.systemCode()))
                .findFirst()
                .orElseThrow()
                .assetTypeId();
    }

    private AssetService.AssetView asset(List<AssetService.AssetView> assets, UUID assetId) {
        return assets.stream()
                .filter(asset -> asset.assetId().equals(assetId))
                .findFirst()
                .orElseThrow();
    }

    private void insertStatement(
            TestLedger ledger,
            UUID cardAssetId,
            LocalDate cycleStart,
            LocalDate cycleEnd,
            LocalDate dueOn,
            String status,
            long billedAmountWon
    ) {
        Timestamp now = Timestamp.from(FIXED_NOW);
        Timestamp settledAt = "PAID".equals(status) ? now : null;
        jdbcTemplate.update("""
                insert into card_statement (
                    id, book_id, card_asset_id, cycle_start, cycle_end, due_on,
                    status, billed_amount_won, finalized_at, settled_at,
                    created_at, updated_at, version
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, UUID.randomUUID(), ledger.bookId(), cardAssetId,
                cycleStart, cycleEnd, dueOn, status, billedAmountWon,
                now, settledAt, now, now);
    }

    private TestLedger createLedger(String displayName) {
        UUID userId = createUser(displayName);
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(userId);
        return new TestLedger(userId, book.ledgerId(), book.members().get(0).memberId());
    }

    private UUID createUser(String displayName) {
        UUID userId = UUID.randomUUID();
        testUsers.add(userId);
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into app_user (
                    id, display_name, email, status, email_verified_at,
                    locale, time_zone, created_at, updated_at, version
                ) values (?, ?, ?, 'ACTIVE', ?, 'ko-KR', 'Asia/Seoul', ?, ?, 0)
                """, userId, displayName, userId + "@asset.test", now, now, now);
        return userId;
    }

    private Outcome createAtLimit(TestLedger ledger, UUID typeId, String name, String key) {
        try {
            assetService.create(
                    ledger.userId(), key,
                    command(typeId, AssetOwnershipScope.PERSONAL, ledger.memberId(), name, 0, null));
            return new Outcome(true, null);
        } catch (ApiException exception) {
            return new Outcome(false, exception.getErrorCode());
        }
    }

    private List<Outcome> runConcurrently(Callable<Outcome> first, Callable<Outcome> second) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<Outcome> firstResult = executor.submit(awaitStart(ready, start, first));
            Future<Outcome> secondResult = executor.submit(awaitStart(ready, start, second));
            ready.await();
            start.countDown();
            return List.of(firstResult.get(), secondResult.get());
        } finally {
            executor.shutdownNow();
        }
    }

    private Callable<Outcome> awaitStart(
            CountDownLatch ready,
            CountDownLatch start,
            Callable<Outcome> action
    ) {
        return () -> {
            ready.countDown();
            start.await();
            return action.call();
        };
    }

    private long count(String sql, UUID id) {
        Long count = jdbcTemplate.queryForObject(sql, Long.class, id);
        return count == null ? 0 : count;
    }

    private record TestLedger(UUID userId, UUID bookId, UUID memberId) {
    }

    private record Outcome(boolean success, String errorCode) {
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockConfiguration {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(FIXED_NOW, ZoneOffset.UTC);
        }
    }
}
