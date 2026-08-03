package com.dondok.auth.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "local_credential")
public class LocalCredentialEntity {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id")
    private AppUserEntity user;

    @Column(name = "login_id", nullable = false, length = 30)
    private String loginId;

    @Column(name = "login_id_normalized", insertable = false, updatable = false)
    private String loginIdNormalized;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "password_algorithm", nullable = false, length = 30)
    private String passwordAlgorithm;

    @Column(name = "password_changed_at", nullable = false)
    private Instant passwordChangedAt;

    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected LocalCredentialEntity() {
    }

    public LocalCredentialEntity(AppUserEntity user, String loginId, String passwordHash, Instant now) {
        this.user = user;
        this.loginId = loginId;
        this.passwordHash = passwordHash;
        this.passwordAlgorithm = "ARGON2ID";
        this.passwordChangedAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void changePassword(String passwordHash, Instant now) {
        this.passwordHash = passwordHash;
        this.passwordChangedAt = now;
        this.failedAttempts = 0;
        this.lockedUntil = null;
        this.updatedAt = now;
    }

    public AppUserEntity getUser() {
        return user;
    }

    public String getLoginId() {
        return loginId;
    }

    public String getLoginIdNormalized() {
        return loginIdNormalized;
    }

    public String getPasswordHash() {
        return passwordHash;
    }
}
