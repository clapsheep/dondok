package com.dondok.membership.application;

import com.dondok.common.error.ApiException;
import com.dondok.membership.domain.LedgerBookStatus;
import com.dondok.membership.infrastructure.persistence.LedgerBookEntity;
import com.dondok.membership.infrastructure.persistence.LedgerBookRepository;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Establishes the root-first lock order for every ledger-scoped write.
 *
 * <p>A membership is read once only to discover the root. After acquiring the root lock it is
 * read again, so a concurrent whole-ledger deletion cannot leave a command operating on stale
 * membership state.</p>
 */
@Component
public class LedgerMutationGuard {

    private final LedgerBookRepository books;
    private final LedgerMemberRepository members;

    public LedgerMutationGuard(LedgerBookRepository books, LedgerMemberRepository members) {
        this.books = books;
        this.members = members;
    }

    public LedgerMemberEntity lockCurrentMember(UUID userId) {
        return lockCurrentLedger(userId, false).member();
    }

    public LedgerMemberEntity lockCurrentMemberExclusively(UUID userId) {
        return lockCurrentLedger(userId, true).member();
    }

    public LockedLedger lockCurrentLedgerExclusively(UUID userId) {
        return lockCurrentLedger(userId, true);
    }

    public LedgerBookEntity lockBook(UUID bookId) {
        return tryLockBook(bookId).orElseThrow(this::ledgerNotFound);
    }

    public Optional<LedgerBookEntity> tryLockBook(UUID bookId) {
        return books.findByIdForShare(bookId).filter(this::isActive);
    }

    private LockedLedger lockCurrentLedger(UUID userId, boolean exclusive) {
        LedgerMemberEntity observed = members.findByUserId(userId).orElseThrow(this::ledgerNotFound);
        LedgerBookEntity book = exclusive
                ? books.findByIdForUpdate(observed.getBookId()).orElseThrow(this::ledgerNotFound)
                : books.findByIdForShare(observed.getBookId()).orElseThrow(this::ledgerNotFound);
        if (!isActive(book)) {
            throw ledgerNotFound();
        }
        LedgerMemberEntity member = members.findByUserId(userId)
                .filter(candidate -> candidate.getBookId().equals(book.getId()))
                .orElseThrow(this::ledgerNotFound);
        return new LockedLedger(book, member);
    }

    private boolean isActive(LedgerBookEntity book) {
        return book.getStatus() == LedgerBookStatus.ACTIVE;
    }

    private ApiException ledgerNotFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND,
                "LEDGER_NOT_FOUND",
                "참여 중인 가계부가 없습니다.");
    }

    public record LockedLedger(LedgerBookEntity book, LedgerMemberEntity member) {
    }
}
