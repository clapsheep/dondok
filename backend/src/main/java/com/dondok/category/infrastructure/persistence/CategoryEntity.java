package com.dondok.category.infrastructure.persistence;

import com.dondok.category.domain.CategoryKind;
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
@Table(name = "category")
public class CategoryEntity {
    @Id private UUID id;
    @Column(name = "book_id", nullable = false) private UUID bookId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10) private CategoryKind kind;
    @Column(name = "system_code", length = 40) private String systemCode;
    @Column(name = "is_fallback", nullable = false) private boolean fallback;
    @Column(nullable = false, length = 100) private String name;
    @Column(name = "icon_key", length = 50) private String iconKey;
    @Column(name = "color_token", length = 50) private String colorToken;
    @Column(name = "sort_order", nullable = false) private int sortOrder;
    @Column(name = "archived_at") private Instant archivedAt;
    @Column(name = "created_by_member_id", nullable = false) private UUID createdByMemberId;
    @Column(name = "updated_by_member_id", nullable = false) private UUID updatedByMemberId;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private Long version;

    protected CategoryEntity() {
    }

    public CategoryEntity(UUID id, UUID bookId, CategoryKind kind, String systemCode,
                          boolean fallback, String name, int sortOrder, UUID memberId, Instant now) {
        this.id = id;
        this.bookId = bookId;
        this.kind = kind;
        this.systemCode = systemCode;
        this.fallback = fallback;
        this.name = name;
        this.sortOrder = sortOrder;
        this.createdByMemberId = memberId;
        this.updatedByMemberId = memberId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID getId() { return id; }
    public UUID getBookId() { return bookId; }
    public CategoryKind getKind() { return kind; }
    public String getSystemCode() { return systemCode; }
    public boolean isFallback() { return fallback; }
    public String getName() { return name; }
    public int getSortOrder() { return sortOrder; }
    public Instant getArchivedAt() { return archivedAt; }
    public Long getVersion() { return version; }

    public void rename(String name, UUID memberId, Instant now) {
        this.name = name;
        this.updatedByMemberId = memberId;
        this.updatedAt = now;
    }

    public void archive(UUID memberId, Instant now) {
        this.archivedAt = now;
        this.updatedByMemberId = memberId;
        this.updatedAt = now;
    }
}
