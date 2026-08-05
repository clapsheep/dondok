package com.dondok.membership.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.category.domain.CategoryKind;
import com.dondok.common.error.ApiException;
import com.dondok.common.security.SecretTokenService;
import com.dondok.settlement.application.CardStatementService;
import com.dondok.transaction.application.CardPurchaseManagementService;
import com.dondok.transaction.application.TransactionService;
import java.sql.Timestamp;
import java.net.URI;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
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
class MembershipServiceIntegrationTest {

    private static final String CONFIRMATION_PHRASE = "가계부 삭제";
    private static final Set<String> LEDGER_CASCADE_TABLES = Set.of(
            "api_idempotency",
            "asset",
            "asset_type",
            "audit_log",
            "card_charge",
            "card_payment_schedule",
            "card_purchase_billing_snapshot",
            "card_purchase_refund",
            "card_purchase_refund_charge",
            "card_purchase_refund_payment",
            "card_setting",
            "card_statement",
            "card_statement_payment",
            "category",
            "debit_card_setting",
            "ledger_invitation",
            "ledger_invitation_redemption",
            "ledger_member",
            "ledger_transaction",
            "savings_setting",
            "transaction_posting");

    @Autowired
    private MembershipService membershipService;

    @Autowired
    private AssetService assetService;

    @Autowired
    private TransactionService transactionService;

    @Autowired
    private CardStatementService cardStatementService;

    @Autowired
    private CardPurchaseManagementService cardPurchaseManagementService;

    @Autowired
    private SecretTokenService tokenService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final List<UUID> testUsers = new ArrayList<>();

    private record InvitationDigests(String linkTokenDigest, String directCodeDigest) {
    }

    @AfterEach
    void cleanUp() {
        for (UUID userId : testUsers) {
            jdbcTemplate.update("delete from ledger_book where created_by_user_id = ?", userId);
        }
        for (UUID userId : testUsers) {
            jdbcTemplate.update("delete from spring_session where primary_id = ?", userId.toString());
        }
        for (UUID userId : testUsers) {
            jdbcTemplate.update("delete from app_user where id = ?", userId);
        }
    }

    @Test
    void anyMemberCanDeleteTheDenseLedgerWhileAccountsAndSessionsRemain() {
        UUID creator = createUser("전체 삭제 생성자");
        UUID firstMember = createUser("전체 삭제 첫 구성원");
        UUID deletingMember = createUser("전체 삭제 실행 구성원");
        MembershipService.LedgerBookView created = membershipService.createLedgerBook(creator);

        MembershipService.IssuedInvitation firstInvitation = membershipService.issueInvitation(creator);
        membershipService.redeemInvitation(firstMember, firstInvitation.code());
        MembershipService.IssuedInvitation secondInvitation = membershipService.issueInvitation(creator);
        membershipService.redeemInvitation(deletingMember, secondInvitation.code());

        UUID creatorMemberId = memberId(created.ledgerId(), creator);
        UUID accountId = assetId(created.ledgerId(), "BANK");
        UUID cardId = assetId(created.ledgerId(), "CREDIT_CARD");
        UUID savingsTypeId = assetTypeId(created.ledgerId(), "SAVINGS");
        UUID expenseCategoryId = categoryId(created.ledgerId(), CategoryKind.EXPENSE, "FOOD");
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));

        AssetService.AssetView card = assetService.asset(creator, cardId);
        assetService.update(
                creator,
                cardId,
                new AssetService.UpdateAssetCommand(
                        new AssetService.AssetCommand(
                                card.assetTypeId(),
                                card.ownershipScope(),
                                card.ownerMemberId(),
                                card.name(),
                                card.openedOn(),
                                card.memo(),
                                card.openingBalanceWon(),
                                new AssetService.CardSettingsCommand(
                                        card.cardSettings().statementClosingDay(),
                                        card.cardSettings().paymentDay(),
                                        card.cardSettings().paymentMonthOffset(),
                                        accountId,
                                        true),
                                null,
                                null),
                        card.version(),
                        false));

        assetService.create(
                creator,
                "cascade-savings-" + created.ledgerId(),
                new AssetService.AssetCommand(
                        savingsTypeId,
                        AssetOwnershipScope.PERSONAL,
                        creatorMemberId,
                        "전체 삭제 적금",
                        today,
                        null,
                        0,
                        null,
                        null,
                        new AssetService.SavingsSettingsCommand(accountId, 20)));
        TransactionService.TransactionView purchase = transactionService.create(
                creator,
                "cascade-purchase-" + created.ledgerId(),
                new TransactionService.CreateExpense(
                        today,
                        10_000,
                        expenseCategoryId,
                        cardId,
                        creatorMemberId,
                        "전체 삭제 카드 구매",
                        1));
        UUID statementId = jdbcTemplate.queryForObject(
                "select statement_id from card_charge where source_transaction_id = ?",
                UUID.class,
                purchase.transactionId());
        CardStatementService.CardStatementDetail statement = cardStatementService.statement(
                creator, statementId);
        CardStatementService.CardStatementPrepaymentPreview paymentPreview = cardStatementService.preview(
                creator,
                statementId,
                new CardStatementService.PrepaymentCommand(10_000, statement.version()));
        cardStatementService.prepay(
                creator,
                statementId,
                "cascade-prepay-" + created.ledgerId(),
                new CardStatementService.PrepaymentApplyCommand(
                        10_000, statement.version(), paymentPreview.previewToken()));
        CardPurchaseManagementService.CardPurchaseRefundPreview refundPreview =
                cardPurchaseManagementService.previewRefund(
                        creator,
                        purchase.transactionId(),
                        new CardPurchaseManagementService.RefundCommand(
                                today, 5_000, purchase.version(), "전체 삭제 환불"));
        cardPurchaseManagementService.refund(
                creator,
                purchase.transactionId(),
                "cascade-refund-" + created.ledgerId(),
                new CardPurchaseManagementService.RefundApplyCommand(
                        today,
                        5_000,
                        purchase.version(),
                        "전체 삭제 환불",
                        refundPreview.previewToken()));
        jdbcTemplate.update("""
                insert into audit_log (
                    book_id, actor_type, actor_member_id, entity_type, entity_id, action
                ) values (?, 'USER', ?, 'LEDGER', ?, 'CASCADE_TEST')
                """, created.ledgerId(), creatorMemberId, created.ledgerId());
        createCredentialAndSession(creator);

        Set<String> actualCascadeTables = Set.copyOf(jdbcTemplate.queryForList("""
                select child.relname
                  from pg_constraint constraint_row
                  join pg_class child on child.oid = constraint_row.conrelid
                 where constraint_row.contype = 'f'
                   and constraint_row.confrelid = 'ledger_book'::regclass
                   and constraint_row.confdeltype = 'c'
                """, String.class));
        assertThat(actualCascadeTables).isEqualTo(LEDGER_CASCADE_TABLES);
        assertThat(LEDGER_CASCADE_TABLES).allSatisfy(table ->
                assertThat(countByBook(table, created.ledgerId()))
                        .as("precondition: %s has a ledger row", table)
                        .isPositive());

        MembershipService.LedgerBookView latest = membershipService.currentLedgerBook(deletingMember).ledger();
        membershipService.deleteCurrentLedgerBook(
                deletingMember,
                deletionCommand(latest));

        assertThat(LEDGER_CASCADE_TABLES).allSatisfy(table ->
                assertThat(countByBook(table, created.ledgerId()))
                        .as("%s was deleted by the parent cascade", table)
                        .isZero());
        assertThat(count("select count(*) from ledger_book where id = ?", created.ledgerId())).isZero();
        assertThat(count("select count(*) from asset_current_balance where book_id = ?", created.ledgerId()))
                .isZero();
        assertThat(count("select count(*) from card_statement_forecast where book_id = ?", created.ledgerId()))
                .isZero();
        assertThat(count("select count(*) from ledger_financial_activity where book_id = ?", created.ledgerId()))
                .isZero();
        assertThat(testUsers).allSatisfy(userId -> {
            assertThat(count("select count(*) from app_user where id = ?", userId)).isOne();
            assertThat(membershipService.currentLedgerBook(userId).ledger()).isNull();
        });
        assertThat(count("select count(*) from local_credential where user_id = ?", creator)).isOne();
        assertThat(count("select count(*) from spring_session where primary_id = ?", creator.toString())).isOne();
        assertThat(count(
                "select count(*) from spring_session_attributes where session_primary_id = ?",
                creator.toString()))
                .isOne();
    }

    @Test
    void deletionRequiresExactPhraseAndCurrentMembership() {
        UUID member = createUser("삭제 확인 사용자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(member);

        assertThatThrownBy(() -> membershipService.deleteCurrentLedgerBook(
                member,
                new MembershipService.DeleteLedgerBookCommand(
                        book.ledgerId(), book.version(), "가계부삭제")))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.getStatus()).isEqualTo(org.springframework.http.HttpStatus.BAD_REQUEST);
                    assertThat(exception.getErrorCode()).isEqualTo("LEDGER_DELETE_CONFIRMATION_INVALID");
                });
        assertThat(count("select count(*) from ledger_book where id = ?", book.ledgerId())).isOne();

        UUID userWithoutLedger = createUser("무소속 삭제 사용자");
        assertThatThrownBy(() -> membershipService.deleteCurrentLedgerBook(
                userWithoutLedger,
                new MembershipService.DeleteLedgerBookCommand(
                        UUID.randomUUID(), 0, CONFIRMATION_PHRASE)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("LEDGER_NOT_FOUND"));
    }

    @Test
    void staleVersionAndOldLedgerIdNeverDeleteTheCurrentLedger() {
        UUID user = createUser("삭제 충돌 사용자");
        MembershipService.LedgerBookView old = membershipService.createLedgerBook(user);

        membershipService.issueInvitation(user);
        MembershipService.LedgerBookView structurallyChanged = membershipService.currentLedgerBook(user).ledger();
        assertThat(structurallyChanged.version()).isGreaterThan(old.version());
        assertThatThrownBy(() -> membershipService.deleteCurrentLedgerBook(user, deletionCommand(old)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
        assertThat(count("select count(*) from ledger_book where id = ?", old.ledgerId())).isOne();

        membershipService.deleteCurrentLedgerBook(user, deletionCommand(structurallyChanged));
        MembershipService.LedgerBookView replacement = membershipService.createLedgerBook(user);
        assertThatThrownBy(() -> membershipService.deleteCurrentLedgerBook(user, deletionCommand(old)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
        assertThat(membershipService.currentLedgerBook(user).ledger().ledgerId())
                .isEqualTo(replacement.ledgerId());
    }

    @Test
    void invitationIssueRevokeAndRedemptionAdvanceTheSharedStructureVersion() {
        UUID creator = createUser("공유 구조 생성자");
        UUID invitee = createUser("공유 구조 참여자");
        MembershipService.LedgerBookView created = membershipService.createLedgerBook(creator);

        MembershipService.IssuedInvitation revoked = membershipService.issueInvitation(creator);
        long afterIssue = membershipService.currentLedgerBook(creator).ledger().version();
        membershipService.revokeInvitation(creator, revoked.invitationId());
        long afterRevoke = membershipService.currentLedgerBook(creator).ledger().version();
        MembershipService.IssuedInvitation accepted = membershipService.issueInvitation(creator);
        long beforeRedeem = membershipService.currentLedgerBook(creator).ledger().version();
        MembershipService.LedgerBookView joined = membershipService.redeemInvitation(invitee, accepted.code());

        assertThat(afterIssue).isGreaterThan(created.version());
        assertThat(afterRevoke).isGreaterThan(afterIssue);
        assertThat(beforeRedeem).isGreaterThan(afterRevoke);
        assertThat(joined.version()).isGreaterThan(beforeRedeem);
        assertThat(membershipService.currentLedgerBook(creator).ledger().version())
                .isEqualTo(joined.version());
    }

    @Test
    void twoConcurrentDeletesProduceOneDeletionAndNoPartialLedger() throws Exception {
        UUID creator = createUser("동시 삭제 생성자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(creator);

        List<Outcome> outcomes = runConcurrently(
                () -> deleteLedger(creator, book),
                () -> deleteLedger(creator, book));

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .containsExactly("LEDGER_NOT_FOUND");
        assertThat(count("select count(*) from ledger_book where id = ?", book.ledgerId())).isZero();
        assertThat(LEDGER_CASCADE_TABLES).allSatisfy(table ->
                assertThat(countByBook(table, book.ledgerId())).isZero());
    }

    @Test
    void deleteAndTransactionWriterUseOneRootLockOrderWithoutDeadlock() throws Exception {
        UUID creator = createUser("삭제 거래 경합 사용자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(creator);
        UUID memberId = memberId(book.ledgerId(), creator);
        UUID accountId = assetId(book.ledgerId(), "BANK");
        UUID categoryId = categoryId(book.ledgerId(), CategoryKind.EXPENSE, "FOOD");

        List<Outcome> outcomes = runConcurrently(
                () -> createExpense(creator, memberId, accountId, categoryId),
                () -> deleteLedger(creator, book));

        assertThat(outcomes.get(1).success()).isTrue();
        assertThat(outcomes.get(0).errorCode()).isIn(null, "LEDGER_NOT_FOUND");
        assertThat(count("select count(*) from ledger_book where id = ?", book.ledgerId())).isZero();
        assertThat(LEDGER_CASCADE_TABLES).allSatisfy(table ->
                assertThat(countByBook(table, book.ledgerId())).isZero());
    }

    @Test
    void issuedDirectCodeAndLinkTokenAreReturnedOnceWhileOnlyTheirDigestsArePersisted() {
        UUID creator = createUser("초대자");
        UUID invitee = createUser("초대 확인 사용자");
        membershipService.createLedgerBook(creator);

        MembershipService.IssuedInvitation issued = membershipService.issueInvitation(creator);

        InvitationDigests stored = jdbcTemplate.queryForObject("""
                select link_token_digest, direct_code_digest
                  from ledger_invitation
                 where id = ?
                """, (resultSet, rowNumber) -> new InvitationDigests(
                resultSet.getString("link_token_digest"),
                resultSet.getString("direct_code_digest")), issued.invitationId());
        String linkToken = URI.create(issued.inviteUrl()).getRawQuery().substring("code=".length());

        assertThat(issued.code()).matches("^[0-9]{6}$");
        assertThat(stored.directCodeDigest()).isEqualTo(tokenService.digest(issued.code()));
        assertThat(stored.linkTokenDigest()).isEqualTo(tokenService.digest(linkToken));
        assertThat(stored.linkTokenDigest()).isNotEqualTo(stored.directCodeDigest());
        assertThat(stored.directCodeDigest()).isNotEqualTo(issued.code());
        assertThat(issued.inviteUrl()).doesNotEndWith(issued.code());
        assertThat(membershipService.previewInvitation(invitee, linkToken).memberCount()).isEqualTo(1);

        MembershipService.InvitationSummary listed = membershipService.invitations(creator).get(0);
        assertThat(listed.invitationId()).isEqualTo(issued.invitationId());
        assertThat(listed.getClass().getRecordComponents())
                .extracting(component -> component.getName())
                .containsExactly("invitationId", "status", "createdAt", "expiresAt");
    }

    @Test
    void issuedDirectCodesAreUnique() {
        UUID creator = createUser("초대 코드 중복 확인자");
        membershipService.createLedgerBook(creator);

        MembershipService.IssuedInvitation first = membershipService.issueInvitation(creator);
        MembershipService.IssuedInvitation second = membershipService.issueInvitation(creator);

        assertThat(first.code()).matches("^[0-9]{6}$");
        assertThat(second.code()).matches("^[0-9]{6}$").isNotEqualTo(first.code());
    }

    @Test
    void directCodeChecksAreRateLimitedPerUser() {
        UUID invitee = createUser("초대 코드 반복 확인자");

        for (int attempt = 0; attempt < 20; attempt++) {
            String code = "%06d".formatted(700_000 + attempt);
            assertThatThrownBy(() -> membershipService.previewInvitation(invitee, code))
                    .isInstanceOfSatisfying(ApiException.class,
                            exception -> assertThat(exception.getErrorCode()).isEqualTo("INVITATION_INVALID"));
        }

        assertThatThrownBy(() -> membershipService.previewInvitation(invitee, "700020"))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("INVITATION_RATE_LIMITED"));
    }

    @Test
    void creatingLedgerBootstrapsFourUsableDefaultAssets() {
        UUID creator = createUser("새 가계부 생성자");
        LocalDate beforeCreation = LocalDate.now(ZoneId.of("Asia/Seoul"));

        MembershipService.LedgerBookView book = membershipService.createLedgerBook(creator);
        LocalDate afterCreation = LocalDate.now(ZoneId.of("Asia/Seoul"));

        UUID creatorMemberId = jdbcTemplate.queryForObject("""
                select id
                  from ledger_member
                 where book_id = ?
                   and user_id = ?
                """, UUID.class, book.ledgerId(), creator);
        List<DefaultAssetRow> defaultAssets = jdbcTemplate.query("""
                select asset.id,
                       asset_type.system_code,
                       asset_type.name as type_name,
                       asset.name,
                       asset.opened_on,
                       asset.sort_order,
                       asset.ownership_scope,
                       asset.owner_member_id
                  from asset
                  join asset_type
                    on asset_type.book_id = asset.book_id
                   and asset_type.id = asset.asset_type_id
                 where asset.book_id = ?
                   and asset.archived_at is null
                 order by asset_type.sort_order, asset.id
                """, (resultSet, rowNumber) -> new DefaultAssetRow(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("system_code"),
                        resultSet.getString("type_name"),
                        resultSet.getString("name"),
                        resultSet.getObject("opened_on", LocalDate.class),
                        resultSet.getInt("sort_order"),
                        resultSet.getString("ownership_scope"),
                        resultSet.getObject("owner_member_id", UUID.class)),
                book.ledgerId());

        assertThat(defaultAssets)
                .extracting(
                        DefaultAssetRow::systemCode,
                        DefaultAssetRow::typeName,
                        DefaultAssetRow::assetName,
                        DefaultAssetRow::sortOrder,
                        DefaultAssetRow::ownershipScope,
                        DefaultAssetRow::ownerMemberId)
                .containsExactly(
                        tuple("CASH", "현금", "현금", 10, "PERSONAL", creatorMemberId),
                        tuple("BANK", "계좌", "계좌", 20, "PERSONAL", creatorMemberId),
                        tuple("CREDIT_CARD", "신용카드", "신용카드", 30, "PERSONAL", creatorMemberId),
                        tuple("DEBIT_CARD", "체크카드", "체크카드", 40, "PERSONAL", creatorMemberId));
        assertThat(defaultAssets).allSatisfy(asset ->
                assertThat(asset.openedOn()).isIn(beforeCreation, afterCreation));
        assertThat(count("""
                select count(*)
                  from asset
                 where book_id = ?
                   and created_by_member_id = owner_member_id
                   and updated_by_member_id = owner_member_id
                """, book.ledgerId())).isEqualTo(4);

        UUID accountId = defaultAssets.stream()
                .filter(asset -> asset.systemCode().equals("BANK"))
                .findFirst()
                .orElseThrow()
                .assetId();
        UUID creditCardId = defaultAssets.stream()
                .filter(asset -> asset.systemCode().equals("CREDIT_CARD"))
                .findFirst()
                .orElseThrow()
                .assetId();
        UUID debitCardId = defaultAssets.stream()
                .filter(asset -> asset.systemCode().equals("DEBIT_CARD"))
                .findFirst()
                .orElseThrow()
                .assetId();

        CardDefault card = jdbcTemplate.queryForObject("""
                select statement_closing_day,
                       payment_day,
                       payment_month_offset,
                       settlement_asset_id,
                       auto_settlement_enabled
                  from card_setting
                 where card_asset_id = ?
                """, (resultSet, rowNumber) -> new CardDefault(
                        resultSet.getShort("statement_closing_day"),
                        resultSet.getShort("payment_day"),
                        resultSet.getShort("payment_month_offset"),
                        resultSet.getObject("settlement_asset_id", UUID.class),
                        resultSet.getBoolean("auto_settlement_enabled")),
                creditCardId);
        assertThat(card).isEqualTo(new CardDefault((short) 14, (short) 25, (short) 1, accountId, false));
        assertThat(jdbcTemplate.queryForObject("""
                select payment_asset_id
                  from debit_card_setting
                 where debit_card_asset_id = ?
                """, UUID.class, debitCardId)).isEqualTo(accountId);
        assertThat(count("select count(*) from ledger_transaction where book_id = ?", book.ledgerId())).isZero();
        assertThat(count("select count(*) from transaction_posting where book_id = ?", book.ledgerId())).isZero();
        assertThat(count("select count(*) from card_charge where book_id = ?", book.ledgerId())).isZero();
        assertThat(count("select count(*) from card_statement where book_id = ?", book.ledgerId())).isZero();
        assertThat(count("select count(*) from card_payment_schedule where book_id = ?", book.ledgerId())).isZero();
    }

    @Test
    void successfulRedemptionRetryBySameUserReturnsTheExistingLedger() {
        UUID creator = createUser("초대자");
        UUID invitee = createUser("참여자");
        MembershipService.LedgerBookView created = membershipService.createLedgerBook(creator);
        MembershipService.IssuedInvitation issued = membershipService.issueInvitation(creator);

        MembershipService.LedgerBookView first = membershipService.redeemInvitation(invitee, issued.code());
        MembershipService.LedgerBookView retried = membershipService.redeemInvitation(invitee, issued.code());

        assertThat(first.ledgerId()).isEqualTo(created.ledgerId());
        assertThat(retried.ledgerId()).isEqualTo(created.ledgerId());
        assertThat(retried.members()).hasSize(2);
        assertThat(count("select count(*) from asset where book_id = ?", created.ledgerId())).isEqualTo(4);
        assertThat(retried.members()).filteredOn(MembershipService.LedgerMemberView::currentUser)
                .singleElement()
                .extracting(MembershipService.LedgerMemberView::displayName)
                .isEqualTo("참여자");
        assertThat(retried.members().get(0).getClass().getRecordComponents())
                .extracting(component -> component.getName())
                .containsExactly("memberId", "displayName", "joinedAt", "currentUser");
        assertThat(retried.getClass().getRecordComponents())
                .extracting(component -> component.getName())
                .containsExactly("ledgerId", "version", "members");
        assertThat(count("select count(*) from ledger_member where user_id = ?", invitee)).isOne();
        assertThat(count("select count(*) from ledger_invitation_redemption where user_id = ?", invitee)).isOne();
    }

    @Test
    void oneInvitationCanOnlyBeAcceptedByOneOfTwoConcurrentUsers() throws Exception {
        UUID creator = createUser("초대자");
        UUID firstInvitee = createUser("첫 참여자");
        UUID secondInvitee = createUser("둘째 참여자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(creator);
        MembershipService.IssuedInvitation invitation = membershipService.issueInvitation(creator);

        List<Outcome> outcomes = runConcurrently(
                () -> redeem(firstInvitee, invitation.code()),
                () -> redeem(secondInvitee, invitation.code()));

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .containsExactly("INVITATION_ALREADY_USED");
        assertThat(count("select count(*) from ledger_member where book_id = ?", book.ledgerId())).isEqualTo(2);
        assertThat(count("select count(*) from ledger_invitation_redemption where invitation_id = ?",
                invitation.invitationId())).isOne();
    }

    @Test
    void oneUserCanOnlyAcceptOneOfTwoConcurrentLedgerInvitations() throws Exception {
        UUID firstCreator = createUser("첫 초대자");
        UUID secondCreator = createUser("둘째 초대자");
        UUID invitee = createUser("동시 참여자");
        membershipService.createLedgerBook(firstCreator);
        membershipService.createLedgerBook(secondCreator);
        MembershipService.IssuedInvitation firstInvitation = membershipService.issueInvitation(firstCreator);
        MembershipService.IssuedInvitation secondInvitation = membershipService.issueInvitation(secondCreator);

        List<Outcome> outcomes = runConcurrently(
                () -> redeem(invitee, firstInvitation.code()),
                () -> redeem(invitee, secondInvitation.code()));

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .containsExactly("USER_ALREADY_HAS_LEDGER");
        assertThat(count("select count(*) from ledger_member where user_id = ?", invitee)).isOne();
        assertThat(count("select count(*) from ledger_invitation_redemption where user_id = ?", invitee)).isOne();
    }

    @Test
    void concurrentLedgerCreationForOneUserLeavesExactlyOneBookAndMembership() throws Exception {
        UUID creator = createUser("동시 생성자");

        List<Outcome> outcomes = runConcurrently(
                () -> createLedger(creator),
                () -> createLedger(creator));

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .containsExactly("USER_ALREADY_HAS_LEDGER");
        assertThat(count("select count(*) from ledger_book where created_by_user_id = ?", creator)).isOne();
        assertThat(count("select count(*) from ledger_member where user_id = ?", creator)).isOne();
        UUID bookId = jdbcTemplate.queryForObject(
                "select id from ledger_book where created_by_user_id = ?", UUID.class, creator);
        assertThat(count("select count(*) from asset where book_id = ?", bookId)).isEqualTo(4);
        assertThat(count("select count(*) from card_setting where book_id = ?", bookId)).isOne();
        assertThat(count("select count(*) from debit_card_setting where book_id = ?", bookId)).isOne();
    }

    @Test
    void creatingAndAcceptingAnInvitationConcurrentlyStillLeavesOneMembership() throws Exception {
        UUID inviter = createUser("초대자");
        UUID invitee = createUser("생성과 참여 동시 요청자");
        membershipService.createLedgerBook(inviter);
        MembershipService.IssuedInvitation invitation = membershipService.issueInvitation(inviter);

        List<Outcome> outcomes = runConcurrently(
                () -> createLedger(invitee),
                () -> redeem(invitee, invitation.code()));

        assertThat(outcomes).filteredOn(Outcome::success).hasSize(1);
        assertThat(outcomes).filteredOn(outcome -> !outcome.success())
                .extracting(Outcome::errorCode)
                .containsExactly("USER_ALREADY_HAS_LEDGER");
        assertThat(count("select count(*) from ledger_member where user_id = ?", invitee)).isOne();
    }

    @Test
    void expiredInvitationHasAStableErrorCode() {
        UUID creator = createUser("초대자");
        UUID invitee = createUser("참여자");
        membershipService.createLedgerBook(creator);
        MembershipService.IssuedInvitation invitation = membershipService.issueInvitation(creator);
        jdbcTemplate.update("""
                update ledger_invitation
                   set created_at = now() - interval '8 days',
                       expires_at = now() - interval '1 day',
                       updated_at = now()
                 where id = ?
                """, invitation.invitationId());

        assertThatThrownBy(() -> membershipService.redeemInvitation(invitee, invitation.code()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("INVITATION_EXPIRED"));
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
                """,
                userId,
                displayName,
                userId + "@membership.test",
                now,
                now,
                now);
        return userId;
    }

    private void createCredentialAndSession(UUID userId) {
        String loginId = "u" + userId.toString().replace("-", "").substring(0, 20);
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into local_credential (
                    user_id, login_id, password_hash, password_algorithm,
                    password_changed_at, created_at, updated_at
                ) values (?, ?, 'integration-test-hash', 'ARGON2ID', ?, ?, ?)
                """, userId, loginId, now, now, now);
        long nowMillis = Instant.now().toEpochMilli();
        jdbcTemplate.update("""
                insert into spring_session (
                    primary_id, session_id, creation_time, last_access_time,
                    max_inactive_interval, expiry_time, principal_name
                ) values (?, ?, ?, ?, 2592000, ?, ?)
                """,
                userId.toString(),
                UUID.randomUUID().toString(),
                nowMillis,
                nowMillis,
                nowMillis + TimeUnit.DAYS.toMillis(30),
                loginId.toLowerCase());
        jdbcTemplate.update("""
                insert into spring_session_attributes (
                    session_primary_id, attribute_name, attribute_bytes
                ) values (?, 'SPRING_SECURITY_CONTEXT', ?)
                """, userId.toString(), new byte[]{1, 2, 3});
    }

    private MembershipService.DeleteLedgerBookCommand deletionCommand(
            MembershipService.LedgerBookView book
    ) {
        return new MembershipService.DeleteLedgerBookCommand(
                book.ledgerId(), book.version(), CONFIRMATION_PHRASE);
    }

    private UUID memberId(UUID bookId, UUID userId) {
        return jdbcTemplate.queryForObject(
                "select id from ledger_member where book_id = ? and user_id = ?",
                UUID.class,
                bookId,
                userId);
    }

    private UUID assetId(UUID bookId, String systemCode) {
        return jdbcTemplate.queryForObject("""
                select asset.id
                  from asset
                  join asset_type type
                    on type.book_id = asset.book_id
                   and type.id = asset.asset_type_id
                 where asset.book_id = ?
                   and type.system_code = ?
                   and asset.archived_at is null
                 order by asset.sort_order, asset.id
                 limit 1
                """, UUID.class, bookId, systemCode);
    }

    private UUID assetTypeId(UUID bookId, String systemCode) {
        return jdbcTemplate.queryForObject(
                "select id from asset_type where book_id = ? and system_code = ? and archived_at is null",
                UUID.class,
                bookId,
                systemCode);
    }

    private UUID categoryId(UUID bookId, CategoryKind kind, String systemCode) {
        return jdbcTemplate.queryForObject("""
                select id from category
                 where book_id = ? and kind = ? and system_code = ? and archived_at is null
                """, UUID.class, bookId, kind.name(), systemCode);
    }

    private Outcome redeem(UUID userId, String code) {
        try {
            membershipService.redeemInvitation(userId, code);
            return new Outcome(true, null);
        } catch (ApiException exception) {
            return new Outcome(false, exception.getErrorCode());
        }
    }

    private Outcome createLedger(UUID userId) {
        try {
            membershipService.createLedgerBook(userId);
            return new Outcome(true, null);
        } catch (ApiException exception) {
            return new Outcome(false, exception.getErrorCode());
        }
    }

    private Outcome deleteLedger(UUID userId, MembershipService.LedgerBookView book) {
        try {
            membershipService.deleteCurrentLedgerBook(userId, deletionCommand(book));
            return new Outcome(true, null);
        } catch (ApiException exception) {
            return new Outcome(false, exception.getErrorCode());
        }
    }

    private Outcome createExpense(
            UUID userId,
            UUID memberId,
            UUID accountId,
            UUID categoryId
    ) {
        try {
            transactionService.create(
                    userId,
                    "delete-writer-" + UUID.randomUUID(),
                    new TransactionService.CreateExpense(
                            LocalDate.now(ZoneId.of("Asia/Seoul")),
                            1_000,
                            categoryId,
                            accountId,
                            memberId,
                            "삭제 경합 거래",
                            1));
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
            return List.of(
                    firstResult.get(15, TimeUnit.SECONDS),
                    secondResult.get(15, TimeUnit.SECONDS));
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

    private long countByBook(String table, UUID bookId) {
        if (!LEDGER_CASCADE_TABLES.contains(table)) {
            throw new IllegalArgumentException("unexpected ledger table: " + table);
        }
        return count("select count(*) from " + table + " where book_id = ?", bookId);
    }

    private long count(String sql, Object id) {
        Long count = jdbcTemplate.queryForObject(sql, Long.class, id);
        return count == null ? 0 : count;
    }

    private record Outcome(boolean success, String errorCode) {
    }

    private record DefaultAssetRow(
            UUID assetId,
            String systemCode,
            String typeName,
            String assetName,
            LocalDate openedOn,
            int sortOrder,
            String ownershipScope,
            UUID ownerMemberId
    ) {
    }

    private record CardDefault(
            short statementClosingDay,
            short paymentDay,
            short paymentMonthOffset,
            UUID settlementAssetId,
            boolean autoSettlementEnabled
    ) {
    }
}
