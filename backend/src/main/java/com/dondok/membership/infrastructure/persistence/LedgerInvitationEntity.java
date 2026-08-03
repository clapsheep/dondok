package com.dondok.membership.infrastructure.persistence;

import com.dondok.membership.domain.InvitationStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "ledger_invitation")
public class LedgerInvitationEntity {

    @Id
    private UUID id;

    @Column(name = "book_id", nullable = false)
    private UUID bookId;

    @Column(name = "inviter_member_id", nullable = false)
    private UUID inviterMemberId;

    @Column(name = "code_digest", nullable = false, length = 64)
    private String codeDigest;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InvitationStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "redeemed_at")
    private Instant redeemedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    protected LedgerInvitationEntity() {
    }

    public LedgerInvitationEntity(
            UUID id,
            UUID bookId,
            UUID inviterMemberId,
            String codeDigest,
            Instant createdAt,
            Instant expiresAt
    ) {
        this.id = id;
        this.bookId = bookId;
        this.inviterMemberId = inviterMemberId;
        this.codeDigest = codeDigest;
        this.status = InvitationStatus.ACTIVE;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
        this.updatedAt = createdAt;
    }

    public InvitationStatus statusAt(Instant now) {
        if (status == InvitationStatus.ACTIVE && !now.isBefore(expiresAt)) {
            return InvitationStatus.EXPIRED;
        }
        return status;
    }

    public void redeem(Instant now) {
        status = InvitationStatus.REDEEMED;
        redeemedAt = now;
        updatedAt = now;
    }

    public void revoke(Instant now) {
        status = InvitationStatus.REVOKED;
        updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getBookId() {
        return bookId;
    }

    public InvitationStatus getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
