package com.dondok.membership.infrastructure.persistence;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LedgerInvitationRepository extends JpaRepository<LedgerInvitationEntity, UUID> {
    interface InvitationTarget {
        UUID getInvitationId();

        UUID getBookId();
    }

    Optional<LedgerInvitationEntity> findByLinkTokenDigest(String linkTokenDigest);

    Optional<LedgerInvitationEntity> findByDirectCodeDigest(String directCodeDigest);

    @Modifying
    @Query(value = """
            insert into ledger_invitation (
                id, book_id, inviter_member_id, link_token_digest, direct_code_digest,
                status, created_at, expires_at, updated_at, version
            ) values (
                :invitationId, :bookId, :inviterMemberId, :linkTokenDigest, :directCodeDigest,
                'ACTIVE', :createdAt, :expiresAt, :createdAt, 0
            )
            on conflict do nothing
            """, nativeQuery = true)
    int insertIssuedInvitation(
            @Param("invitationId") UUID invitationId,
            @Param("bookId") UUID bookId,
            @Param("inviterMemberId") UUID inviterMemberId,
            @Param("linkTokenDigest") String linkTokenDigest,
            @Param("directCodeDigest") String directCodeDigest,
            @Param("createdAt") Instant createdAt,
            @Param("expiresAt") Instant expiresAt
    );

    @Query("""
            select invitation.id as invitationId, invitation.bookId as bookId
            from LedgerInvitationEntity invitation
            where invitation.linkTokenDigest = :digest
            """)
    Optional<InvitationTarget> findTargetByLinkTokenDigest(@Param("digest") String digest);

    @Query("""
            select invitation.id as invitationId, invitation.bookId as bookId
            from LedgerInvitationEntity invitation
            where invitation.directCodeDigest = :digest
            """)
    Optional<InvitationTarget> findTargetByDirectCodeDigest(@Param("digest") String digest);

    List<LedgerInvitationEntity> findAllByBookIdOrderByCreatedAtDescIdDesc(UUID bookId);

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
