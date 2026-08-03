package com.dondok.membership.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "ledger_invitation_redemption")
public class LedgerInvitationRedemptionEntity {

    @Id
    @Column(name = "invitation_id")
    private UUID invitationId;

    @Column(name = "book_id", nullable = false)
    private UUID bookId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "member_id", nullable = false)
    private UUID memberId;

    @Column(name = "redeemed_at", nullable = false)
    private Instant redeemedAt;

    protected LedgerInvitationRedemptionEntity() {
    }

    public LedgerInvitationRedemptionEntity(
            UUID invitationId,
            UUID bookId,
            UUID userId,
            UUID memberId,
            Instant redeemedAt
    ) {
        this.invitationId = invitationId;
        this.bookId = bookId;
        this.userId = userId;
        this.memberId = memberId;
        this.redeemedAt = redeemedAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getBookId() {
        return bookId;
    }
}
