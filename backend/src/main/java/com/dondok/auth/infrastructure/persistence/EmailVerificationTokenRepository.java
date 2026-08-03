package com.dondok.auth.infrastructure.persistence;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface EmailVerificationTokenRepository extends JpaRepository<EmailVerificationTokenEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<EmailVerificationTokenEntity> findByTokenDigest(String tokenDigest);

    @Modifying
    @Query("update EmailVerificationTokenEntity token set token.usedAt = CURRENT_TIMESTAMP "
            + "where token.userId = :userId and token.usedAt is null")
    void expireActiveForUser(@Param("userId") UUID userId);
}
