package com.dondok.membership.infrastructure.persistence;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LedgerInvitationRedemptionRepository
        extends JpaRepository<LedgerInvitationRedemptionEntity, UUID> {
    Optional<LedgerInvitationRedemptionEntity> findByInvitationId(UUID invitationId);
}
