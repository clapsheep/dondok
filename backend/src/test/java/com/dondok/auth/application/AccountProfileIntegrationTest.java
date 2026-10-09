package com.dondok.auth.application;

import static org.assertj.core.api.Assertions.*;
import com.dondok.common.error.ApiException;
import com.dondok.common.security.SecretTokenService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

@SpringBootTest(properties = "dondok.mail.enabled=false")
class AccountProfileIntegrationTest {
    @Autowired AccountProfileService profiles;
    @Autowired AuthService auth;
    @Autowired AccountWithdrawalService withdrawal;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired SecretTokenService tokens;
    private static final String PASSWORD = "Dondok-pass-2026!";
    private final List<UUID> users = new ArrayList<>();

    @AfterEach void clean() { users.forEach(id -> jdbc.update("delete from app_user where id = ?", id)); }

    @Test void saveRequiresPasswordAndFreshVersionAndKeepsOldEmailUntilVerifiedSave() {
        UUID id = user(); var before = profiles.profile(id); String target = email();
        code(() -> profiles.save(id, "수정", before.email(), "wrong", before.version()), "ACCOUNT_PASSWORD_INVALID");
        code(() -> profiles.save(id, "수정", target, PASSWORD, before.version()), "EMAIL_CHANGE_NOT_VERIFIED");
        profiles.requestEmail(id, target, before.version()); setCode(id, "12345678");
        assertThat(profiles.confirmEmail(id, target, "12345678")).isTrue();
        assertThat(profiles.profile(id).email()).isEqualTo(before.email());
        auth.requestPasswordReset(before.email());
        var saved = profiles.save(id, "  새 이름  ", target.toUpperCase(), PASSWORD, before.version());
        assertThat(saved.displayName()).isEqualTo("새 이름"); assertThat(saved.email()).isEqualTo(target);
        assertThat(saved.version()).isGreaterThan(before.version());
        assertThat(count("password_reset_token", id)).isZero();
        assertThat(count("account_email_change", id)).isZero();
        code(() -> profiles.save(id, "이전 화면", target, PASSWORD, before.version()), "VERSION_CONFLICT");
    }

    @Test void challengesAreBoundToUserEmailVersionExpiryAndAreLimitedToFiveAttempts() {
        UUID id = user(), other = user(); var before = profiles.profile(id); String target = email();
        profiles.requestEmail(id, target, before.version()); setCode(id, "12345678");
        code(() -> profiles.requestEmail(id, email(), before.version()), "EMAIL_CHANGE_RATE_LIMITED");
        assertThat(profiles.confirmEmail(other, target, "12345678")).isFalse();
        assertThat(profiles.confirmEmail(id, email(), "12345678")).isFalse();
        for (int i = 0; i < 5; i++) assertThat(profiles.confirmEmail(id, target, "00000000")).isFalse();
        assertThat(profiles.confirmEmail(id, target, "12345678")).isFalse();
        assertThat(jdbc.queryForObject("select attempts from account_email_change where user_id = ?", Integer.class, id)).isEqualTo(5);
        jdbc.update("update account_email_change set created_at = now() - interval '2 minutes' where user_id = ?", id);
        profiles.requestEmail(id, target, before.version()); setCode(id, "87654321");
        assertThat(profiles.confirmEmail(id, target, "12345678")).isFalse();
        assertThat(profiles.confirmEmail(id, target, "87654321")).isTrue();
        jdbc.update("update account_email_change set created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute' where user_id = ?", id);
        code(() -> profiles.save(id, "수정", target, PASSWORD, before.version()), "EMAIL_CHANGE_NOT_VERIFIED");
    }

    @Test void emailUniquenessIsRecheckedAtSaveAndNameOnlyEditsNeedNoEmailVerification() {
        UUID id = user(), other = user(); var first = profiles.profile(id); var second = profiles.profile(other);
        code(() -> profiles.requestEmail(id, second.email(), first.version()), "EMAIL_ALREADY_EXISTS");
        String sharedTarget = email();
        for (UUID account : List.of(id, other)) {
            profiles.requestEmail(account, sharedTarget, profiles.profile(account).version()); setCode(account, "12345678");
            assertThat(profiles.confirmEmail(account, sharedTarget, "12345678")).isTrue();
        }
        profiles.save(other, "다른 회원", sharedTarget, PASSWORD, second.version());
        code(() -> profiles.save(id, "수정", sharedTarget, PASSWORD, first.version()), "EMAIL_ALREADY_EXISTS");
        var updated = profiles.save(id, "이름만 수정", first.email(), PASSWORD, first.version());
        assertThat(updated.displayName()).isEqualTo("이름만 수정");
        assertThat(updated.email()).isEqualTo(first.email());
    }

    @Test void passwordChangeChecksBothInputsAndInvalidatesSessionsResetTokensAndEmailChallenges() {
        UUID id = user(); var user = profiles.profile(id);
        profiles.requestEmail(id, email(), user.version()); auth.requestPasswordReset(user.email());
        jdbc.update("insert into spring_session (primary_id, session_id, creation_time, last_access_time, max_inactive_interval, expiry_time, principal_name) values (?, ?, 1, 1, 999, 9999999999999, ?)", UUID.randomUUID().toString(), UUID.randomUUID().toString(), user.loginId());
        code(() -> profiles.changePassword(id, "wrong", "New-password-123!", "New-password-123!"), "ACCOUNT_PASSWORD_INVALID");
        code(() -> profiles.changePassword(id, PASSWORD, "New-password-123!", "Mismatch-123!"), "PASSWORD_CONFIRMATION_MISMATCH");
        assertThat(count("password_reset_token", id)).isEqualTo(1);
        profiles.changePassword(id, PASSWORD, "New-password-123!", "New-password-123!");
        String hash = jdbc.queryForObject("select password_hash from local_credential where user_id = ?", String.class, id);
        assertThat(passwords.matches("New-password-123!", hash)).isTrue(); assertThat(passwords.matches(PASSWORD, hash)).isFalse();
        assertThat(count("password_reset_token", id)).isZero(); assertThat(count("account_email_change", id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from spring_session where principal_name = ?", Integer.class, user.loginId())).isZero();
    }

    @Test void concurrentProfileSavesCannotOverwriteEachOther() throws Exception {
        UUID id = user(); var profile = profiles.profile(id); var executor = Executors.newFixedThreadPool(2);
        try {
            var results = executor.invokeAll(List.of(
                    () -> attemptSave(id, "첫 번째", profile), () -> attemptSave(id, "두 번째", profile)));
            assertThat(List.of(results.get(0).get(), results.get(1).get())).containsExactlyInAnyOrder("OK", "VERSION_CONFLICT");
        } finally { executor.shutdownNow(); }
    }

    @Test void resetAndProfilePasswordChangesSerializeAndWithdrawalDeletesChallenge() throws Exception {
        UUID id = user(); var profile = profiles.profile(id);
        profiles.requestEmail(id, email(), profile.version());
        withdrawal.withdraw(id, new AccountWithdrawalService.Command(PASSWORD, true, null, null));
        assertThat(count("account_email_change", id)).isZero();
        UUID next = user(); auth.requestPasswordReset(profiles.profile(next).email());
        String raw = "test-reset-" + UUID.randomUUID();
        jdbc.update("update password_reset_token set token_digest = ? where user_id = ?", tokens.digest(raw), next);
        var executor = Executors.newFixedThreadPool(2);
        try {
            var results = executor.invokeAll(List.of(
                    () -> outcome(() -> auth.resetPassword(raw, "Reset-password-123!")),
                    () -> outcome(() -> profiles.changePassword(next, PASSWORD, "New-password-123!", "New-password-123!"))));
            assertThat(List.of(results.get(0).get(), results.get(1).get())).containsOnlyOnce("OK");
        } finally { executor.shutdownNow(); }
    }
    private String attemptSave(UUID id, String name, AccountProfileService.Profile profile) {
        return outcome(() -> profiles.save(id, name, profile.email(), PASSWORD, profile.version()));
    }
    private String outcome(Runnable action) { try { action.run(); return "OK"; } catch (ApiException ex) { return ex.getErrorCode(); } }
    private void setCode(UUID id, String code) { jdbc.update("update account_email_change set code_hash = ? where user_id = ?", passwords.encode(code), id); }
    private int count(String table, UUID id) { return jdbc.queryForObject("select count(*) from " + table + " where user_id = ?", Integer.class, id); }
    private String email() { return "profile_" + UUID.randomUUID() + "@example.test"; }
    private UUID user() {
        String login = "p_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        auth.signUp(login, "원래 이름", login + "@example.test", PASSWORD, new SignUpConsent(SignUpConsent.CURRENT_VERSION, true, true, true));
        UUID id = jdbc.queryForObject("select user_id from local_credential where login_id = ?", UUID.class, login);
        users.add(id); jdbc.update("update app_user set status = 'ACTIVE', email_verified_at = now() where id = ?", id); return id;
    }
    private void code(Runnable action, String code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(code));
    }
}
