package com.dondok.transaction.application;

import com.dondok.transaction.domain.TransferSubtype;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Application boundary for non-user-managed transfers such as card settlement. */
public interface ManagedTransferPort {
    ManagedTransfer create(CreateCommand command);

    ManagedTransfer find(UUID bookId, UUID transactionId);

    record CreateCommand(
            UUID transactionId,
            UUID bookId,
            TransferSubtype transferSubtype,
            LocalDate occurredOn,
            long amountWon,
            String description,
            String sourceType,
            UUID sourceId,
            UUID createdByMemberId,
            Instant now,
            List<Posting> postings
    ) {
    }

    record Posting(UUID assetId, String assetName, long deltaWon) {
        public Posting(UUID assetId, long deltaWon) {
            this(assetId, null, deltaWon);
        }
    }

    record Member(UUID memberId, String displayName) {
    }

    record ManagedTransfer(
            UUID transactionId,
            TransferSubtype transferSubtype,
            LocalDate occurredOn,
            long amountWon,
            String description,
            Member createdBy,
            List<Posting> postings,
            long version,
            Instant createdAt,
            Instant updatedAt
    ) {
    }
}
