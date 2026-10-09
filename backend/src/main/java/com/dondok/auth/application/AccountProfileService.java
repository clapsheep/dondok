package com.dondok.auth.application;

import com.dondok.auth.domain.UserStatus;
import com.dondok.auth.infrastructure.persistence.AppUserEntity;
import com.dondok.auth.infrastructure.persistence.AppUserRepository;
import com.dondok.auth.infrastructure.persistence.LocalCredentialEntity;
import com.dondok.auth.infrastructure.persistence.LocalCredentialRepository;
import com.dondok.common.error.ApiException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountProfileService {
    private final EntityManager em;
    private final AppUserRepository users;
    private final LocalCredentialRepository credentials;
    private final PasswordEncoder passwords;
    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public AccountProfileService(EntityManager em, AppUserRepository users, LocalCredentialRepository credentials,
            PasswordEncoder passwords, JdbcTemplate jdbc, ApplicationEventPublisher events, Clock clock) {
        this.em = em; this.users = users; this.credentials = credentials;
        this.passwords = passwords; this.jdbc = jdbc; this.events = events; this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Profile profile(UUID id) {
        return view(active(id, false));
    }

    @Transactional
    public void requestEmail(UUID id, String email, long expectedVersion) {
        var user = active(id, true);
        checkVersion(user, expectedVersion);
        String target = normalize(email);
        if (target.equals(user.getEmail())) throw new ApiException(HttpStatus.BAD_REQUEST,
                "EMAIL_UNCHANGED", "현재 이메일과 다른 주소를 입력해 주세요.");
        checkAvailable(target);
        Instant now = clock.instant();
        var previous = challenge(id);
        if (previous != null && previous.createdAt().plusSeconds(60).isAfter(now)) throw new ApiException(
                HttpStatus.TOO_MANY_REQUESTS, "EMAIL_CHANGE_RATE_LIMITED", "인증번호는 1분 후 다시 받을 수 있어요.");
        String code = String.format(Locale.ROOT, "%08d", random.nextInt(100_000_000));
        // Salted Argon2 protects the short code even if the challenge table is exposed.
        jdbc.update("""
                insert into account_email_change (user_id, email, code_hash, profile_version, created_at, expires_at)
                values (?, ?, ?, ?, ?, ?)
                on conflict (user_id) do update set email = excluded.email, code_hash = excluded.code_hash,
                    profile_version = excluded.profile_version, created_at = excluded.created_at,
                    expires_at = excluded.expires_at, attempts = 0, verified = false
                """, id, target, passwords.encode(code), expectedVersion, Timestamp.from(now), Timestamp.from(now.plusSeconds(600)));
        events.publishEvent(new AuthMailEvent(AuthMailEvent.Type.EMAIL_CHANGE, target, user.getDisplayName(), code));
    }

    @Transactional
    public boolean confirmEmail(UUID id, String email, String code) {
        var user = active(id, true);
        var challenge = challenge(id);
        if (!usable(challenge, user, normalize(email)) || challenge.attempts() >= 5) return false;
        if (!passwords.matches(code, challenge.hash())) {
            // Return failure after committing the attempt counter; throwing here would roll it back.
            jdbc.update("update account_email_change set attempts = attempts + 1 where user_id = ?", id);
            return false;
        }
        jdbc.update("update account_email_change set verified = true where user_id = ?", id);
        return true;
    }

    @Transactional
    public Profile save(UUID id, String name, String email, String password, long expectedVersion) {
        var user = active(id, true);
        checkVersion(user, expectedVersion);
        checkPassword(id, password);
        String target = normalize(email);
        if (!target.equals(user.getEmail())) {
            var challenge = challenge(id);
            if (!usable(challenge, user, target) || !challenge.verified()) throw new ApiException(
                    HttpStatus.BAD_REQUEST, "EMAIL_CHANGE_NOT_VERIFIED", "새 이메일을 인증해 주세요. 인증번호는 10분 동안 유효해요.");
            checkAvailable(target);
            jdbc.update("delete from password_reset_token where user_id = ?", id);
        }
        user.updateProfile(name.strip(), target, clock.instant());
        jdbc.update("delete from account_email_change where user_id = ?", id);
        em.flush();
        return view(user);
    }

    @Transactional
    public void changePassword(UUID id, String currentPassword, String newPassword, String confirmation) {
        active(id, true);
        if (!newPassword.equals(confirmation)) throw new ApiException(HttpStatus.BAD_REQUEST,
                "PASSWORD_CONFIRMATION_MISMATCH", "새 비밀번호가 서로 달라요.");
        var credential = checkPassword(id, currentPassword);
        credential.changePassword(passwords.encode(newPassword), clock.instant());
        jdbc.update("delete from password_reset_token where user_id = ?", id);
        jdbc.update("delete from account_email_change where user_id = ?", id);
        jdbc.update("delete from spring_session where principal_name = ?", credential.getLoginIdNormalized());
        em.flush();
    }

    private AppUserEntity active(UUID id, boolean lock) {
        var user = lock ? em.find(AppUserEntity.class, id, LockModeType.PESSIMISTIC_WRITE) : em.find(AppUserEntity.class, id);
        if (user == null || user.getStatus() != UserStatus.ACTIVE) throw new ApiException(
                HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "로그인이 필요합니다.");
        return user;
    }
    private LocalCredentialEntity checkPassword(UUID id, String password) {
        var credential = credentials.findById(id).orElseThrow();
        if (!passwords.matches(password, credential.getPasswordHash())) throw new ApiException(
                HttpStatus.FORBIDDEN, "ACCOUNT_PASSWORD_INVALID", "현재 비밀번호가 일치하지 않아요.");
        return credential;
    }
    private void checkVersion(AppUserEntity user, long expected) {
        if (user.getVersion() != expected) throw new ApiException(HttpStatus.PRECONDITION_FAILED,
                "VERSION_CONFLICT", "다른 화면에서 계정 정보가 변경됐어요. 최신 정보를 확인해 주세요.");
    }
    private void checkAvailable(String email) {
        if (users.existsByEmailNormalized(email)) throw new ApiException(HttpStatus.CONFLICT,
                "EMAIL_ALREADY_EXISTS", "이미 사용 중인 이메일입니다.");
    }
    private boolean usable(Challenge challenge, AppUserEntity user, String email) {
        return challenge != null && challenge.email().equals(email) && challenge.version() == user.getVersion()
                && challenge.expiresAt().isAfter(clock.instant());
    }
    private Challenge challenge(UUID id) {
        return jdbc.query("select * from account_email_change where user_id = ?", (rs, row) -> new Challenge(
                rs.getString("email"), rs.getString("code_hash"), rs.getLong("profile_version"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("expires_at").toInstant(),
                rs.getInt("attempts"), rs.getBoolean("verified")), id).stream().findFirst().orElse(null);
    }
    private Profile view(AppUserEntity user) {
        return new Profile(user.getId().toString(), credentials.findById(user.getId()).orElseThrow().getLoginId(),
                user.getDisplayName(), user.getEmail(), user.getVersion());
    }
    private String normalize(String value) { return value.strip().toLowerCase(Locale.ROOT); }
    private record Challenge(String email, String hash, long version, Instant createdAt, Instant expiresAt, int attempts, boolean verified) {}
    public record Profile(String userId, String loginId, String displayName, String email, long version) {}
}
