package com.dondok.auth.infrastructure.persistence;

import com.dondok.auth.domain.UserStatus;
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
@Table(name = "app_user")
public class AppUserEntity {

    @Id
    private UUID id;

    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(name = "email_normalized", insertable = false, updatable = false)
    private String emailNormalized;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private UserStatus status;

    @Column(name = "email_verified_at")
    private Instant emailVerifiedAt;

    @Column(nullable = false, length = 10)
    private String locale;

    @Column(name = "time_zone", nullable = false, length = 50)
    private String timeZone;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "withdrawn_at")
    private Instant withdrawnAt;

    @Version
    private long version;

    protected AppUserEntity() {
    }

    public AppUserEntity(UUID id, String displayName, String email, Instant now) {
        this.id = id;
        this.displayName = displayName;
        this.email = email;
        this.status = UserStatus.PENDING_VERIFICATION;
        this.locale = "ko-KR";
        this.timeZone = "Asia/Seoul";
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void verifyEmail(Instant now) {
        this.emailVerifiedAt = now;
        this.status = UserStatus.ACTIVE;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getEmail() {
        return email;
    }

    public String getEmailNormalized() {
        return emailNormalized;
    }

    public UserStatus getStatus() {
        return status;
    }

    public Instant getEmailVerifiedAt() {
        return emailVerifiedAt;
    }
}
