package com.dondok.auth.application;

import com.dondok.auth.domain.UserStatus;
import com.dondok.auth.infrastructure.persistence.AppUserEntity;
import com.dondok.auth.infrastructure.persistence.AppUserRepository;
import com.dondok.auth.infrastructure.persistence.EmailVerificationTokenEntity;
import com.dondok.auth.infrastructure.persistence.EmailVerificationTokenRepository;
import com.dondok.auth.infrastructure.persistence.LocalCredentialEntity;
import com.dondok.auth.infrastructure.persistence.LocalCredentialRepository;
import com.dondok.auth.infrastructure.persistence.PasswordResetTokenEntity;
import com.dondok.auth.infrastructure.persistence.PasswordResetTokenRepository;
import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.common.security.SecretTokenService;
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
public class AuthService {

    private final AppUserRepository users;
    private final LocalCredentialRepository credentials;
    private final EmailVerificationTokenRepository verificationTokens;
    private final PasswordResetTokenRepository resetTokens;
    private final PasswordEncoder passwordEncoder;
    private final SecretTokenService tokenService;
    private final AuthProperties properties;
    private final ApplicationEventPublisher events;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    public AuthService(
            AppUserRepository users,
            LocalCredentialRepository credentials,
            EmailVerificationTokenRepository verificationTokens,
            PasswordResetTokenRepository resetTokens,
            PasswordEncoder passwordEncoder,
            SecretTokenService tokenService,
            AuthProperties properties,
            ApplicationEventPublisher events,
            JdbcTemplate jdbcTemplate,
            Clock clock
    ) {
        this.users = users;
        this.credentials = credentials;
        this.verificationTokens = verificationTokens;
        this.resetTokens = resetTokens;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.properties = properties;
        this.events = events;
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    @Transactional
    public SignUpResult signUp(String loginId, String displayName, String email, String password) {
        String normalizedLoginId = normalize(loginId);
        String normalizedEmail = normalize(email);
        if (credentials.existsByLoginIdNormalized(normalizedLoginId)) {
            throw new ApiException(HttpStatus.CONFLICT, "LOGIN_ID_ALREADY_EXISTS", "이미 사용 중인 아이디입니다.");
        }
        if (users.existsByEmailNormalized(normalizedEmail)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "이미 사용 중인 이메일입니다.");
        }

        Instant now = clock.instant();
        AppUserEntity user = users.save(new AppUserEntity(UuidV7.next(), displayName.strip(), normalizedEmail, now));
        credentials.save(new LocalCredentialEntity(user, normalizedLoginId, passwordEncoder.encode(password), now));

        SecretTokenService.IssuedToken token = tokenService.issue();
        verificationTokens.save(new EmailVerificationTokenEntity(
                UuidV7.next(),
                user.getId(),
                token.digest(),
                now,
                now.plus(properties.verificationTokenTtl())));
        events.publishEvent(new AuthMailEvent(
                AuthMailEvent.Type.EMAIL_VERIFICATION,
                user.getEmail(),
                user.getDisplayName(),
                token.rawToken()));
        return new SignUpResult(user.getEmail());
    }

    @Transactional(readOnly = true)
    public boolean isLoginIdAvailable(String loginId) {
        return !credentials.existsByLoginIdNormalized(normalize(loginId));
    }

    @Transactional
    public void verifyEmail(String rawToken) {
        Instant now = clock.instant();
        EmailVerificationTokenEntity token = verificationTokens.findByTokenDigest(tokenService.digest(rawToken))
                .orElseThrow(this::invalidToken);
        if (!token.isUsableAt(now)) {
            throw invalidToken();
        }
        AppUserEntity user = users.findById(token.getUserId()).orElseThrow(this::invalidToken);
        token.markUsed(now);
        user.verifyEmail(now);
        verificationTokens.expireActiveForUser(user.getId());
    }

    @Transactional
    public void requestPasswordReset(String email) {
        String normalizedEmail = normalize(email);
        users.findByEmailNormalized(normalizedEmail)
                .filter(user -> user.getStatus() == UserStatus.ACTIVE)
                .ifPresent(this::issuePasswordReset);
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        Instant now = clock.instant();
        PasswordResetTokenEntity token = resetTokens.findByTokenDigest(tokenService.digest(rawToken))
                .orElseThrow(this::invalidToken);
        if (!token.isUsableAt(now)) {
            throw invalidToken();
        }
        LocalCredentialEntity credential = credentials.findById(token.getUserId())
                .orElseThrow(this::invalidToken);
        credential.changePassword(passwordEncoder.encode(newPassword), now);
        token.markUsed(now);
        resetTokens.expireActiveForUser(token.getUserId());
        deleteSessionsForPrincipal(credential.getLoginIdNormalized());
    }

    @Transactional
    public void deleteAllSessions(String loginId) {
        deleteSessionsForPrincipal(normalize(loginId));
    }

    private void issuePasswordReset(AppUserEntity user) {
        Instant now = clock.instant();
        resetTokens.expireActiveForUser(user.getId());
        SecretTokenService.IssuedToken token = tokenService.issue();
        resetTokens.save(new PasswordResetTokenEntity(
                UuidV7.next(),
                user.getId(),
                token.digest(),
                now,
                now.plus(properties.resetTokenTtl())));
        events.publishEvent(new AuthMailEvent(
                AuthMailEvent.Type.PASSWORD_RESET,
                user.getEmail(),
                user.getDisplayName(),
                token.rawToken()));
    }

    private void deleteSessionsForPrincipal(String principalName) {
        jdbcTemplate.update("delete from spring_session where principal_name = ?", principalName);
    }

    private String normalize(String value) {
        return value.strip().toLowerCase(Locale.ROOT);
    }

    private ApiException invalidToken() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "TOKEN_INVALID_OR_EXPIRED",
                "유효하지 않거나 만료된 링크입니다.");
    }

    public record SignUpResult(String email) {
    }
}
