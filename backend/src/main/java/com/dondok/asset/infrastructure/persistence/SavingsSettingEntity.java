package com.dondok.asset.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "savings_setting")
public class SavingsSettingEntity {
    @Id
    @Column(name = "savings_asset_id")
    private UUID savingsAssetId;
    @Column(name = "book_id", nullable = false)
    private UUID bookId;
    @Column(name = "transfer_asset_id", nullable = false)
    private UUID transferAssetId;
    @Column(name = "transfer_day", nullable = false)
    private short transferDay;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    private Long version;

    protected SavingsSettingEntity() {
    }

    public SavingsSettingEntity(
            UUID savingsAssetId, UUID bookId, UUID transferAssetId, short transferDay, Instant now
    ) {
        this.savingsAssetId = savingsAssetId;
        this.bookId = bookId;
        this.transferAssetId = transferAssetId;
        this.transferDay = transferDay;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(UUID transferAssetId, short transferDay, Instant now) {
        this.transferAssetId = transferAssetId;
        this.transferDay = transferDay;
        this.updatedAt = now;
    }

    public UUID getSavingsAssetId() { return savingsAssetId; }
    public UUID getTransferAssetId() { return transferAssetId; }
    public short getTransferDay() { return transferDay; }
}
