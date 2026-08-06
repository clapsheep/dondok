package com.dondok.asset.infrastructure.persistence;

import com.dondok.asset.domain.AssetOwnershipScope;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "asset")
public class AssetEntity {
    @Id private UUID id;
    @Column(name = "book_id", nullable = false) private UUID bookId;
    @Column(name = "asset_type_id", nullable = false) private UUID assetTypeId;
    @Enumerated(EnumType.STRING)
    @Column(name = "ownership_scope", nullable = false, length = 10)
    private AssetOwnershipScope ownershipScope;
    @Column(name = "owner_member_id") private UUID ownerMemberId;
    @Column(nullable = false, length = 100) private String name;
    @Column(name = "opened_on", nullable = false) private LocalDate openedOn;
    @Column(name = "balance_anchor_won", nullable = false) private long balanceAnchorWon;
    @Column(length = 1000) private String memo;
    @Column(name = "include_in_net_worth", nullable = false) private boolean includeInNetWorth;
    @Column(name = "sort_order", nullable = false) private int sortOrder;
    @Column(name = "archived_at") private Instant archivedAt;
    @Column(name = "archived_by_member_id") private UUID archivedByMemberId;
    @Column(name = "created_by_member_id", nullable = false) private UUID createdByMemberId;
    @Column(name = "updated_by_member_id", nullable = false) private UUID updatedByMemberId;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private Long version;

    protected AssetEntity() {
    }

    public AssetEntity(
            UUID id, UUID bookId, UUID assetTypeId, AssetOwnershipScope ownershipScope,
            UUID ownerMemberId, String name, LocalDate openedOn, String memo,
            long balanceAnchorWon, int sortOrder, UUID memberId, Instant now
    ) {
        this.id = id;
        this.bookId = bookId;
        this.assetTypeId = assetTypeId;
        this.ownershipScope = ownershipScope;
        this.ownerMemberId = ownerMemberId;
        this.name = name;
        this.openedOn = openedOn;
        this.balanceAnchorWon = balanceAnchorWon;
        this.memo = memo;
        this.includeInNetWorth = true;
        this.sortOrder = sortOrder;
        this.createdByMemberId = memberId;
        this.updatedByMemberId = memberId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(
            UUID assetTypeId, AssetOwnershipScope ownershipScope, UUID ownerMemberId,
            String name, LocalDate openedOn, String memo, long balanceAnchorWon,
            UUID updatedByMemberId, Instant now
    ) {
        this.assetTypeId = assetTypeId;
        this.ownershipScope = ownershipScope;
        this.ownerMemberId = ownerMemberId;
        this.name = name;
        this.openedOn = openedOn;
        this.balanceAnchorWon = balanceAnchorWon;
        this.memo = memo;
        this.updatedByMemberId = updatedByMemberId;
        this.updatedAt = now;
    }

    public void archive(UUID memberId, Instant now) {
        this.archivedAt = now;
        this.archivedByMemberId = memberId;
        this.updatedByMemberId = memberId;
        this.updatedAt = now;
    }

    public UUID getId() { return id; }
    public UUID getBookId() { return bookId; }
    public UUID getAssetTypeId() { return assetTypeId; }
    public AssetOwnershipScope getOwnershipScope() { return ownershipScope; }
    public UUID getOwnerMemberId() { return ownerMemberId; }
    public String getName() { return name; }
    public LocalDate getOpenedOn() { return openedOn; }
    public long getBalanceAnchorWon() { return balanceAnchorWon; }
    public String getMemo() { return memo; }
    public Instant getArchivedAt() { return archivedAt; }
    public boolean isArchived() { return archivedAt != null; }
    public long getVersion() { return version == null ? 0 : version; }
}
