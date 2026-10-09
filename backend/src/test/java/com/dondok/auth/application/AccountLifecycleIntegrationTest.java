package com.dondok.auth.application;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(properties = "dondok.mail.enabled=false")
class AccountLifecycleIntegrationTest {
    @Autowired JdbcTemplate jdbc;
    private static final Instant NOW = Instant.parse("2028-02-29T03:00:00Z");
    private final List<UUID> users = new ArrayList<>();
    private AccountLifecycleService lifecycle;

    @BeforeEach void setup() { lifecycle = new AccountLifecycleService(jdbc, Clock.fixed(NOW, ZoneOffset.UTC)); }
    @AfterEach void clean() { users.forEach(id -> jdbc.update("delete from app_user where id = ?", id)); }

    @Test void calendarYearBoundaryMarksDormancyWithoutChangingIdentityEligibilityOrProfileVersion() {
        var cutoff = Instant.parse("2027-02-28T03:00:00Z");
        UUID old = user("ACTIVE", cutoff), recent = user("ACTIVE", cutoff.plusSeconds(1));
        UUID pending = user("PENDING_VERIFICATION", cutoff), locked = user("LOCKED", cutoff);
        lifecycle.maintain();
        assertThat(dormant(old)).isTrue(); assertThat(dormant(pending)).isTrue();
        assertThat(dormant(recent)).isFalse(); assertThat(dormant(locked)).isFalse();
        assertThat(jdbc.queryForObject("select status from app_user where id = ?", String.class, old)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select version from app_user where id = ?", Long.class, old)).isZero();
        assertThat(lifecycle.maintain().dormantAccounts()).isZero();
    }

    @Test void onlyCurrentlyValidVerifiedCredentialsRestoreDormancy() {
        UUID id = user("ACTIVE", NOW.minusSeconds(400 * 86400L));
        UUID pending = user("PENDING_VERIFICATION", NOW.minusSeconds(400 * 86400L));
        lifecycle.maintain();
        assertThat(lifecycle.recordAuthenticatedActivity(id, "wrong-hash")).isFalse();
        assertThat(dormant(id)).isTrue();
        assertThat(lifecycle.recordAuthenticatedActivity(pending, "test-hash")).isFalse();
        assertThat(lifecycle.recordAuthenticatedActivity(id, "test-hash")).isTrue();
        assertThat(dormant(id)).isFalse();
        assertThat(jdbc.queryForObject("select last_active_at from app_user where id = ?", Timestamp.class, id).toInstant()).isEqualTo(NOW);
        jdbc.update("delete from app_user where id = ?", id);
        assertThat(lifecycle.recordAuthenticatedActivity(id, "test-hash")).isFalse();
    }

    @Test void cleanupDeletesOnlyExpiredOrConsumedTokensAndPreservesLiveChallengesAndConsent() {
        UUID id = user("ACTIVE", NOW);
        for (String table : List.of("email_verification_token", "password_reset_token")) {
            token(table, id, NOW.minusSeconds(1), false);
            token(table, id, NOW.plusSeconds(300), true);
            token(table, id, NOW.plusSeconds(300), false);
        }
        jdbc.update("insert into account_email_change(user_id,email,code_hash,profile_version,created_at,expires_at) values (?, 'test@example.test','hash',0,?,?)",
                id, Timestamp.from(NOW.minusSeconds(300)), Timestamp.from(NOW.plusSeconds(60)));
        jdbc.update("insert into account_consent values (?, 'test', ?, true, true, true)", id, Timestamp.from(NOW));
        var result = lifecycle.maintain();
        assertThat(result.expiredTokens()).isGreaterThanOrEqualTo(4);
        for (String table : List.of("email_verification_token", "password_reset_token", "account_email_change", "account_consent")) {
            assertThat(jdbc.queryForObject("select count(*) from " + table + " where user_id = ?", Integer.class, id)).isEqualTo(1);
        }
        jdbc.update("update account_email_change set expires_at = ? where user_id = ?", Timestamp.from(NOW), id);
        lifecycle.maintain();
        assertThat(jdbc.queryForObject("select count(*) from account_email_change where user_id = ?", Integer.class, id)).isZero();
    }

    @Test void maintenanceRacingWithActivityCannotLeaveAnActiveUserDormant() throws Exception {
        UUID id = user("ACTIVE", NOW.minusSeconds(400 * 86400L));
        var executor = Executors.newFixedThreadPool(2);
        try {
            var start = new java.util.concurrent.CountDownLatch(1);
            var marking = executor.submit(() -> { start.await(); lifecycle.maintain(); return true; });
            var activity = executor.submit(() -> { start.await(); return lifecycle.recordAuthenticatedActivity(id, "test-hash"); });
            start.countDown();
            assertThat(activity.get()).isTrue(); assertThat(marking.get()).isTrue();
            assertThat(dormant(id)).isFalse();
        } finally { executor.shutdownNow(); }
    }

    private boolean dormant(UUID id) { return Boolean.TRUE.equals(jdbc.queryForObject("select dormant_at is not null from app_user where id = ?", Boolean.class, id)); }

    private UUID user(String status, Instant activeAt) {
        UUID id = UUID.randomUUID(); users.add(id);
        jdbc.update("insert into app_user(id,display_name,email,status,email_verified_at,last_active_at) values (?, '테스트', ?, ?, ?, ?)",
                id, id + "@example.test", status, status.equals("PENDING_VERIFICATION") ? null : Timestamp.from(NOW), Timestamp.from(activeAt));
        jdbc.update("insert into local_credential(user_id,login_id,password_hash) values (?, ?, 'test-hash')", id, "life_" + id.toString().substring(0, 12));
        return id;
    }

    private void token(String table, UUID user, Instant expiry, boolean used) {
        jdbc.update("insert into " + table + " (id,user_id,token_digest,created_at,expires_at,used_at) values (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID(), user, UUID.randomUUID().toString().replace("-", "").repeat(2),
                Timestamp.from(NOW.minusSeconds(600)), Timestamp.from(expiry), used ? Timestamp.from(NOW.minusSeconds(10)) : null);
    }
}
