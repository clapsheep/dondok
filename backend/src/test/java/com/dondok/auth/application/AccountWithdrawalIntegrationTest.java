package com.dondok.auth.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.transaction.application.TransactionService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

@SpringBootTest(properties = "dondok.mail.enabled=false")
class AccountWithdrawalIntegrationTest {
    @Autowired AccountWithdrawalService withdrawal;
    @Autowired AuthService auth;
    @Autowired MembershipService membership;
    @Autowired TransactionService transactions;
    @Autowired com.dondok.asset.application.AssetService assets;
    @Autowired com.dondok.settlement.application.CardPaymentItemService payments;
    @Autowired com.dondok.settlement.application.CardStatementService statements;
    @Autowired com.dondok.transaction.application.CardPurchaseManagementService purchases;
    @Autowired JdbcTemplate jdbc;
    @Autowired LedgerMutationGuard guard;
    @Autowired PlatformTransactionManager transactionManager;
    private final List<UUID> users = new ArrayList<>();
    private static final String PASSWORD = "Withdrawal-test-2026!";

    @AfterEach void clean() {
        users.forEach(id -> jdbc.update("delete from ledger_book where id in (select book_id from ledger_member where user_id = ?) or created_by_user_id = ?", id, id));
        users.forEach(id -> jdbc.update("delete from app_user where id = ?", id));
    }

    @Test void sharedHistoryAndBalancesRemainButIdentityCredentialsTokensAndSessionsDisappear() {
        UUID first = user(), second = user();
        var original = membership.createLedgerBook(first);
        var invite = membership.issueInvitation(first);
        membership.redeemInvitation(second, invite.code());
        var unused = membership.issueInvitation(first);
        var book = membership.currentLedgerBook(first).ledger();
        var member = book.members().stream().filter(m -> m.currentUser()).findFirst().orElseThrow();
        UUID cash = jdbc.queryForObject("select id from asset where book_id = ? and name = '현금'", UUID.class, book.ledgerId());
        UUID category = jdbc.queryForObject("select id from category where book_id = ? and kind = 'EXPENSE' limit 1", UUID.class, book.ledgerId());
        var transaction = transactions.create(first, "withdrawal-" + first, new TransactionService.CreateExpense(
                LocalDate.now(), 7300, category, cash, member.memberId(), "보존할 공동 기록", 1));
        var postings = jdbc.queryForList("select * from transaction_posting where book_id = ? order by transaction_id, line_no", book.ledgerId());
        jdbc.update("update category set name = '개인 식별 분류' where id = ?", category);
        String login = jdbc.queryForObject("select login_id from local_credential where user_id = ?", String.class, first);
        jdbc.update("insert into spring_session (primary_id, session_id, creation_time, last_access_time, max_inactive_interval, expiry_time, principal_name) values (?, ?, 1, 1, 999, 9999999999999, ?)", UUID.randomUUID().toString(), UUID.randomUUID().toString(), login);
        auth.requestPasswordReset(email(first));
        withdrawal.withdraw(first, command(book));
        assertThat(jdbc.queryForList("select * from transaction_posting where book_id = ? order by transaction_id, line_no", book.ledgerId())).isEqualTo(postings);
        assertThat(transactions.transaction(second, transaction.transactionId()).performedBy().displayName()).isEqualTo("탈퇴한 구성원");
        assertThat(jdbc.queryForObject("select name from category where id = ?", String.class, category)).startsWith("기록 분류 ");
        assertThat(membership.currentLedgerBook(first).ledger()).isNull();
        var retained = membership.currentLedgerBook(second).ledger();
        assertThat(retained.ledgerId()).isEqualTo(original.ledgerId());
        assertThat(retained.members().stream().filter(MembershipService.LedgerMemberView::withdrawn)).hasSize(1);
        assertThat(retained.version()).isGreaterThan(book.version());
        for (String table : List.of("local_credential", "email_verification_token", "password_reset_token", "oauth_identity")) {
            assertThat(jdbc.queryForObject("select count(*) from " + table + " where user_id = ?", Integer.class, first)).isZero();
        }
        assertThat(jdbc.queryForObject("select count(*) from spring_session where principal_name = ?", Integer.class, login)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from ledger_invitation where id = ?", Integer.class, unused.invitationId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from app_user where id = ?", Integer.class, first)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from ledger_member where id = ?", Integer.class, member.memberId())).isZero();
        assertThat(transactions.transaction(second, transaction.transactionId()).description()).isNull();
        assertThat(transactions.transaction(second, transaction.transactionId()).performedBy().memberId()).isNotEqualTo(member.memberId());
        assertThat(jdbc.queryForObject("select count(*) from account_consent where user_id = ?", Integer.class, first)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from audit_log where book_id = ?", Integer.class, book.ledgerId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from api_idempotency where book_id = ?", Integer.class, book.ledgerId())).isZero();
        assertThat(auth.isLoginIdAvailable(login)).isTrue();
        assertThatThrownBy(() -> membership.createLedgerBook(first)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> new TransactionTemplate(transactionManager).execute(status -> guard.lockCurrentMember(first))).isInstanceOf(ApiException.class);
    }

    @Test void multipleDeparturesShareOneLedgerMarkerAndCannotBeSelectedForNewActivity() {
        UUID first = user(), second = user(), third = user();
        membership.createLedgerBook(first);
        membership.redeemInvitation(second, membership.issueInvitation(first).code());
        membership.redeemInvitation(third, membership.issueInvitation(first).code());
        var book = membership.currentLedgerBook(first).ledger();
        UUID cash = jdbc.queryForObject("select id from asset where book_id = ? and name = '현금'", UUID.class, book.ledgerId());
        UUID category = jdbc.queryForObject("select id from category where book_id = ? and kind = 'EXPENSE' limit 1", UUID.class, book.ledgerId());
        UUID firstMember = book.members().stream().filter(m -> m.currentUser()).findFirst().orElseThrow().memberId();
        UUID thirdMember = membership.currentLedgerBook(third).ledger().members().stream().filter(m -> m.currentUser()).findFirst().orElseThrow().memberId();
        // Another member may record an expense from a different name-holder's asset.
        var expense = transactions.create(second, "proxy-expense", new TransactionService.CreateExpense(
                LocalDate.now(), 3210, category, cash, thirdMember, "개인 메모", 1));
        long balance = jdbc.queryForObject("select current_balance_won from asset_current_balance where asset_id = ?", Long.class, cash);
        withdrawal.withdraw(first, command(book));
        UUID marker = jdbc.queryForObject("select id from ledger_member where book_id = ? and user_id is null", UUID.class, book.ledgerId());
        assertCode(() -> transactions.create(third, "invalid-performer", new TransactionService.CreateExpense(
                LocalDate.now(), 100, category, cash, marker, null, 1)), "TRANSACTION_PERFORMER_INVALID");
        assertCode(() -> transactions.create(third, "old-performer", new TransactionService.CreateExpense(
                LocalDate.now(), 100, category, cash, firstMember, null, 1)), "TRANSACTION_PERFORMER_INVALID");
        withdrawal.withdraw(second, command(membership.currentLedgerBook(second).ledger()));
        assertThat(jdbc.queryForList("select id from ledger_member where book_id = ? and user_id is null", UUID.class, book.ledgerId())).containsExactly(marker);
        assertThat(transactions.transaction(third, expense.transactionId()).createdBy().memberId()).isEqualTo(marker);
        assertThat(transactions.transaction(third, expense.transactionId()).performedBy().memberId()).isEqualTo(thirdMember);
        assertThat(transactions.transaction(third, expense.transactionId()).description()).isNull();
        assertThat(jdbc.queryForObject("select current_balance_won from asset_current_balance where asset_id = ?", Long.class, cash)).isEqualTo(balance);
        assertThat(jdbc.queryForObject("select count(*) from app_user where id in (?, ?)", Integer.class, first, second)).isZero();
        // The departed inviter's links cannot be redeemed, but the remaining member can invite.
        assertThat(membership.issueInvitation(third).code()).isNotBlank();
    }

    @Test void sameOwnerConnectionsKeepProxyEntryAndPaidCardRefundsWorkingAfterWithdrawal() {
        UUID first = user(), second = user();
        membership.createLedgerBook(first);
        membership.redeemInvitation(second, membership.issueInvitation(first).code());
        var book = membership.currentLedgerBook(first).ledger();
        UUID firstMember = book.members().stream().filter(m -> m.currentUser()).findFirst().orElseThrow().memberId();
        UUID secondMember = membership.currentLedgerBook(second).ledger().members().stream().filter(m -> m.currentUser()).findFirst().orElseThrow().memberId();
        var bank = assets.create(first, "own-bank", assetCommand(first, firstMember, "BANK", "삭제할 이름", null));
        var otherBank = assets.create(first, "other-bank", assetCommand(first, secondMember, "BANK", "남은 계좌", null));
        assertCode(() -> assets.create(first, "bad-card", assetCommand(first, firstMember, "CREDIT_CARD", "실패 카드", otherBank.assetId())),
                "CROSS_MEMBER_ASSET_CONNECTION_NOT_ALLOWED");
        var card = assets.create(first, "own-card", assetCommand(first, firstMember, "CREDIT_CARD", "삭제할 카드 이름", bank.assetId()));
        assertCode(() -> assets.update(first, bank.assetId(), new com.dondok.asset.application.AssetService.UpdateAssetCommand(
                assetCommand(first, secondMember, "BANK", "삭제할 이름", null), bank.version(), false)), "CROSS_MEMBER_ASSET_CONNECTION_NOT_ALLOWED");
        UUID category = jdbc.queryForObject("select id from category where book_id = ? and kind = 'EXPENSE' limit 1", UUID.class, book.ledgerId());
        var purchase = transactions.create(second, "proxy-card-purchase", new TransactionService.CreateExpense(
                LocalDate.now(), 7000, category, card.assetId(), secondMember, "삭제할 거래 설명", 1));
        var selection = payments.list(second, card.assetId(), null, 20);
        var badPayment = new com.dondok.settlement.application.CardPaymentItemService.Command(selection.snapshotToken(),
                "SELECTED", "ALL", List.of(), List.of(), null, otherBank.assetId(), LocalDate.now());
        assertCode(() -> payments.pay(second, card.assetId(), "wrong-owner", badPayment), "CROSS_MEMBER_ASSET_CONNECTION_NOT_ALLOWED");
        var paid = payments.pay(second, card.assetId(), "proxy-payment",
                new com.dondok.settlement.application.CardPaymentItemService.Command(selection.snapshotToken(),
                        "SELECTED", "ALL", List.of(), List.of(), null, bank.assetId(), LocalDate.now()));
        var beforePostings = jdbc.queryForList("select * from transaction_posting where book_id = ? order by transaction_id, line_no", book.ledgerId());
        var beforePayments = jdbc.queryForList("select id, amount_won, settlement_asset_id, settlement_transaction_id from card_statement_payment where book_id = ? order by id", book.ledgerId());
        withdrawal.withdraw(first, command(membership.currentLedgerBook(first).ledger()));
        assertThat(jdbc.queryForList("select * from transaction_posting where book_id = ? order by transaction_id, line_no", book.ledgerId())).isEqualTo(beforePostings);
        assertThat(jdbc.queryForList("select id, amount_won, settlement_asset_id, settlement_transaction_id from card_statement_payment where book_id = ? order by id", book.ledgerId())).isEqualTo(beforePayments);
        assertThat(assets.asset(second, bank.assetId()).name()).startsWith("기록 자산 ");
        assertThat(assets.asset(second, bank.assetId()).memo()).isNull();
        assertThat(statements.statement(second, paid.payments().get(0).statementId()).remainingAmountWon()).isZero();
        var management = purchases.management(second, purchase.transactionId());
        var preview = purchases.previewRefund(second, purchase.transactionId(),
                new com.dondok.transaction.application.CardPurchaseManagementService.RefundCommand(LocalDate.now(), 7000, management.purchase().version(), null));
        purchases.refund(second, purchase.transactionId(), "after-withdrawal-refund",
                new com.dondok.transaction.application.CardPurchaseManagementService.RefundApplyCommand(LocalDate.now(), 7000,
                        management.purchase().version(), null, preview.previewToken()));
        assertThat(assets.asset(second, bank.assetId()).currentBalanceWon()).isZero();
        assertThat(assets.asset(second, card.assetId()).currentBalanceWon()).isZero();
        assertThat(assets.asset(second, otherBank.assetId()).currentBalanceWon()).isZero();
    }

    private com.dondok.asset.application.AssetService.AssetCommand assetCommand(UUID user, UUID owner, String type, String name, UUID source) {
        UUID typeId = assets.assetTypes(user).stream().filter(t -> t.systemCode().equals(type)).findFirst().orElseThrow().assetTypeId();
        return new com.dondok.asset.application.AssetService.AssetCommand(typeId,
                com.dondok.asset.domain.AssetOwnershipScope.PERSONAL, owner, name, LocalDate.now().minusDays(1), "개인 메모", 0,
                source == null ? null : new com.dondok.asset.application.AssetService.CardSettingsCommand(14, 25, 0, source, false));
    }

    @Test void lastMemberDeletesLedgerEvenWhenEarlierWithdrawnMemberRowsRemain() {
        UUID first = user(), second = user();
        membership.createLedgerBook(first);
        membership.redeemInvitation(second, membership.issueInvitation(first).code());
        withdrawal.withdraw(first, command(membership.currentLedgerBook(first).ledger()));
        var last = membership.currentLedgerBook(second).ledger();
        withdrawal.withdraw(second, command(last));
        for (String table : List.of("ledger_member", "asset", "ledger_transaction", "category", "ledger_invitation"))
            assertThat(jdbc.queryForObject("select count(*) from " + table + " where book_id = ?", Integer.class, last.ledgerId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from ledger_book where id = ?", Integer.class, last.ledgerId())).isZero();
    }

    @Test void wrongPasswordMissingConfirmationAndStaleSnapshotDoNotDeleteAnything() {
        UUID id = user();
        var book = membership.createLedgerBook(id);
        assertCode(() -> withdrawal.withdraw(id, new AccountWithdrawalService.Command("wrong", true, book.ledgerId(), book.version())), "ACCOUNT_PASSWORD_INVALID");
        assertCode(() -> withdrawal.withdraw(id, new AccountWithdrawalService.Command(PASSWORD, false, book.ledgerId(), book.version())), "ACCOUNT_WITHDRAWAL_CONFIRMATION_REQUIRED");
        membership.issueInvitation(id);
        assertCode(() -> withdrawal.withdraw(id, command(book)), "ACCOUNT_WITHDRAWAL_STALE");
        assertThat(jdbc.queryForObject("select status from app_user where id = ?", String.class, id)).isEqualTo("ACTIVE");
        assertThat(membership.currentLedgerBook(id).ledger()).isNotNull();
    }

    @Test void noLedgerAccountCanWithdrawButCannotDeleteARecentlyCreatedLedger() {
        UUID id = user();
        withdrawal.withdraw(id, new AccountWithdrawalService.Command(PASSWORD, true, null, null));
        assertThat(jdbc.queryForObject("select count(*) from app_user where id = ?", Integer.class, id)).isZero();
        UUID next = user();
        membership.createLedgerBook(next);
        assertCode(() -> withdrawal.withdraw(next, new AccountWithdrawalService.Command(PASSWORD, true, null, null)), "ACCOUNT_WITHDRAWAL_STALE");
    }

    @Test void simultaneousWithdrawalsRequireTheSecondMemberToConfirmLastMemberDeletion() throws Exception {
        UUID a = user(), b = user();
        membership.createLedgerBook(a);
        membership.redeemInvitation(b, membership.issueInvitation(a).code());
        var book = membership.currentLedgerBook(a).ledger();
        var executor = Executors.newFixedThreadPool(2);
        try {
            var outcomes = executor.invokeAll(List.of(
                () -> attempt(a, book), () -> attempt(b, book)));
            var results = List.of(outcomes.get(0).get(10, TimeUnit.SECONDS), outcomes.get(1).get(10, TimeUnit.SECONDS));
            assertThat(results).containsExactlyInAnyOrder("OK", "ACCOUNT_WITHDRAWAL_STALE");
            assertThat(jdbc.queryForObject("select count(*) from ledger_book where id = ?", Integer.class, book.ledgerId())).isEqualTo(1);
        } finally { executor.shutdownNow(); }
    }

    private String attempt(UUID id, MembershipService.LedgerBookView book) {
        try { withdrawal.withdraw(id, command(book)); return "OK"; }
        catch (ApiException ex) { return ex.getErrorCode(); }
    }
    private UUID user() {
        String login = "w_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        auth.signUp(login, "테스트 구성원", login + "@example.test", PASSWORD, new SignUpConsent(SignUpConsent.CURRENT_VERSION, true, true, true));
        UUID id = jdbc.queryForObject("select user_id from local_credential where login_id = ?", UUID.class, login);
        users.add(id);
        jdbc.update("update app_user set status = 'ACTIVE', email_verified_at = now() where id = ?", id);
        return id;
    }
    private String email(UUID id) { return jdbc.queryForObject("select email from app_user where id = ?", String.class, id); }
    private AccountWithdrawalService.Command command(MembershipService.LedgerBookView book) {
        return new AccountWithdrawalService.Command(PASSWORD, true, book.ledgerId(), book.version());
    }
    private void assertCode(Runnable action, String code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(code));
    }
}
