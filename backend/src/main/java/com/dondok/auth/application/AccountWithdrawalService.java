package com.dondok.auth.application;

import com.dondok.auth.domain.UserStatus;
import com.dondok.auth.infrastructure.persistence.AppUserEntity;
import com.dondok.auth.infrastructure.persistence.LocalCredentialRepository;
import com.dondok.common.error.ApiException;
import com.dondok.membership.infrastructure.persistence.LedgerBookRepository;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountWithdrawalService {
    private final EntityManager entityManager;
    private final LocalCredentialRepository credentials;
    private final PasswordEncoder passwords;
    private final LedgerMemberRepository members;
    private final LedgerBookRepository books;
    private final JdbcTemplate jdbc;

    public AccountWithdrawalService(EntityManager entityManager, LocalCredentialRepository credentials,
            PasswordEncoder passwords, LedgerMemberRepository members, LedgerBookRepository books,
            JdbcTemplate jdbc) {
        this.entityManager = entityManager;
        this.credentials = credentials;
        this.passwords = passwords;
        this.members = members;
        this.books = books;
        this.jdbc = jdbc;
    }

    @Transactional
    public void withdraw(UUID userId, Command command) {
        if (!command.confirmed()) throw new ApiException(HttpStatus.BAD_REQUEST,
                "ACCOUNT_WITHDRAWAL_CONFIRMATION_REQUIRED", "탈퇴 후 처리 내용을 확인해 주세요.");
        // Same user -> ledger lock order as ledger creation and invitation redemption.
        var user = entityManager.find(AppUserEntity.class, userId, LockModeType.PESSIMISTIC_WRITE);
        if (user == null || user.getStatus() != UserStatus.ACTIVE) throw new ApiException(
                HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "로그인이 필요합니다.");
        var credential = credentials.findById(userId).orElseThrow(() -> new ApiException(
                HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "로그인이 필요합니다."));
        if (!passwords.matches(command.password(), credential.getPasswordHash())) throw new ApiException(
                HttpStatus.FORBIDDEN, "ACCOUNT_PASSWORD_INVALID", "현재 비밀번호가 일치하지 않아요.");

        var member = members.findByUserId(userId).orElse(null);
        if (!Objects.equals(member == null ? null : member.getBookId(), command.expectedLedgerId())) throw stale();
        if (member != null) {
            var book = books.findByIdForUpdate(member.getBookId()).orElseThrow(this::stale);
            // A concurrent delete/recreate or invite/withdrawal must require a fresh confirmation.
            if (command.expectedVersion() == null || book.getVersion() != command.expectedVersion()
                    || members.findByUserId(userId).filter(m -> m.getBookId().equals(book.getId())).isEmpty()) throw stale();
        } else if (command.expectedVersion() != null) {
            throw stale();
        }

        entityManager.flush();
        jdbc.queryForObject("select erase_ledger_account(?)", Object.class, userId);
        // The SQL command erases entities loaded for authentication and snapshot validation.
        entityManager.clear();
    }

    private ApiException stale() {
        return new ApiException(HttpStatus.PRECONDITION_FAILED, "ACCOUNT_WITHDRAWAL_STALE",
                "확인하는 동안 가계부 구성이 바뀌었어요. 최신 내용을 확인한 후 다시 진행해 주세요.");
    }

    public record Command(String password, boolean confirmed, UUID expectedLedgerId, Long expectedVersion) {}
}
