package com.dondok.asset.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "debit_card_setting")
public class DebitCardSettingEntity {
    @Id
    @Column(name = "debit_card_asset_id")
    private UUID debitCardAssetId;
    @Column(name = "book_id", nullable = false)
    private UUID bookId;
    @Column(name = "payment_asset_id", nullable = false)
    private UUID paymentAssetId;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    private Long version;

    protected DebitCardSettingEntity() {
    }

    public DebitCardSettingEntity(
            UUID debitCardAssetId, UUID bookId, UUID paymentAssetId, Instant now
    ) {
        this.debitCardAssetId = debitCardAssetId;
        this.bookId = bookId;
        this.paymentAssetId = paymentAssetId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(UUID paymentAssetId, Instant now) {
        this.paymentAssetId = paymentAssetId;
        this.updatedAt = now;
    }

    public UUID getDebitCardAssetId() { return debitCardAssetId; }
    public UUID getPaymentAssetId() { return paymentAssetId; }
}
