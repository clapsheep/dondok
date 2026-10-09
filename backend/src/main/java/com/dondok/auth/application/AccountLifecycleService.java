package com.dondok.auth.application;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Dormancy is reversible metadata, never withdrawal or a change to shared-ledger membership. */
@Service
public class AccountLifecycleService {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public AccountLifecycleService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Transactional
    public boolean recordAuthenticatedActivity(UUID userId, String authenticatedPasswordHash) {
        // Recheck the credential to prevent a login racing with password change/withdrawal.
        return jdbc.update("""
                update app_user u set last_active_at = ?, dormant_at = null
                from local_credential c
                where u.id = ? and c.user_id = u.id and u.status = 'ACTIVE'
                  and c.password_hash = ?
                """, Timestamp.from(clock.instant()), userId, authenticatedPasswordHash) == 1;
    }

    @Transactional
    public MaintenanceResult maintain() {
        var now = clock.instant();
        var cutoff = now.atZone(ZoneId.of("Asia/Seoul")).minusYears(1).toInstant();
        // Row locks serialize with successful activity; a simultaneous login always leaves the user active.
        int dormant = jdbc.update("""
                update app_user set dormant_at = ?
                where dormant_at is null and status in ('ACTIVE', 'PENDING_VERIFICATION')
                  and last_active_at <= ?
                """, Timestamp.from(now), Timestamp.from(cutoff));
        int tokens = jdbc.update("delete from email_verification_token where expires_at <= ? or used_at is not null", Timestamp.from(now));
        tokens += jdbc.update("delete from password_reset_token where expires_at <= ? or used_at is not null", Timestamp.from(now));
        int challenges = jdbc.update("delete from account_email_change where expires_at <= ?", Timestamp.from(now));
        return new MaintenanceResult(dormant, tokens, challenges);
    }

    public record MaintenanceResult(int dormantAccounts, int expiredTokens, int expiredChallenges) {}
}
