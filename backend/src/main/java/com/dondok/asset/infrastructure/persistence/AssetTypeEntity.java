package com.dondok.asset.infrastructure.persistence;

import com.dondok.asset.domain.AssetBehavior;
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
@Table(name = "asset_type")
public class AssetTypeEntity {

    @Id
    private UUID id;

    @Column(name = "book_id", nullable = false)
    private UUID bookId;

    @Column(name = "system_code", nullable = false, length = 30)
    private String systemCode;

    @Column(nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AssetBehavior behavior;

    @Column(name = "payment_source_capable", nullable = false)
    private boolean paymentSourceCapable;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "created_by_member_id", nullable = false)
    private UUID createdByMemberId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    protected AssetTypeEntity() {
    }

    public AssetTypeEntity(
            UUID id,
            UUID bookId,
            String systemCode,
            String name,
            AssetBehavior behavior,
            boolean paymentSourceCapable,
            int sortOrder,
            UUID createdByMemberId,
            Instant now
    ) {
        this.id = id;
        this.bookId = bookId;
        this.systemCode = systemCode;
        this.name = name;
        this.behavior = behavior;
        this.paymentSourceCapable = paymentSourceCapable;
        this.sortOrder = sortOrder;
        this.createdByMemberId = createdByMemberId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID getId() { return id; }
    public UUID getBookId() { return bookId; }
    public String getSystemCode() { return systemCode; }
    public String getName() { return name; }
    public AssetBehavior getBehavior() { return behavior; }
    public boolean isPaymentSourceCapable() { return paymentSourceCapable; }
    public int getSortOrder() { return sortOrder; }
}
