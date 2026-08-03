package com.dondok.membership.infrastructure.persistence;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LedgerInvitationRepository extends JpaRepository<LedgerInvitationEntity, UUID> {
    interface InvitationTarget {
        UUID getInvitationId();

        UUID getBookId();
    }

    Optional<LedgerInvitationEntity> findByCodeDigest(String codeDigest);

    @Query("""
            select invitation.id as invitationId, invitation.bookId as bookId
            from LedgerInvitationEntity invitation
            where invitation.codeDigest = :codeDigest
            """)
    Optional<InvitationTarget> findTargetByCodeDigest(@Param("codeDigest") String codeDigest);

    List<LedgerInvitationEntity> findAllByBookIdOrderByCreatedAtDescIdDesc(UUID bookId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select invitation from LedgerInvitationEntity invitation where invitation.codeDigest = :codeDigest")
    Optional<LedgerInvitationEntity> findByCodeDigestForUpdate(@Param("codeDigest") String codeDigest);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select invitation
            from LedgerInvitationEntity invitation
            where invitation.id = :invitationId and invitation.bookId = :bookId
            """)
    Optional<LedgerInvitationEntity> findByIdAndBookIdForUpdate(
            @Param("invitationId") UUID invitationId,
            @Param("bookId") UUID bookId
    );
}
