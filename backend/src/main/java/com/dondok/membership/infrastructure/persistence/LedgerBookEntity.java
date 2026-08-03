package com.dondok.membership.infrastructure.persistence;

import com.dondok.membership.domain.LedgerBookStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "ledger_book")
public class LedgerBookEntity {

    @Id
    private UUID id;

    @Column(name = "base_currency", nullable = false, length = 3, columnDefinition = "char(3)")
    @JdbcTypeCode(SqlTypes.CHAR)
    private String baseCurrency;

    @Column(name = "time_zone", nullable = false, length = 50)
    private String timeZone;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private LedgerBookStatus status;

    @Column(name = "created_by_user_id", nullable = false)
    private UUID createdByUserId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Version
    private Long version;

    protected LedgerBookEntity() {
    }

    public LedgerBookEntity(UUID id, UUID createdByUserId, Instant now) {
        this.id = id;
        this.baseCurrency = "KRW";
        this.timeZone = "Asia/Seoul";
        this.status = LedgerBookStatus.ACTIVE;
        this.createdByUserId = createdByUserId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public LedgerBookStatus getStatus() {
        return status;
    }

    public long getVersion() {
        return version == null ? 0 : version;
    }

    public void touch(Instant now) {
        this.updatedAt = !now.isAfter(updatedAt) ? updatedAt.plusNanos(1_000) : now;
    }
}
