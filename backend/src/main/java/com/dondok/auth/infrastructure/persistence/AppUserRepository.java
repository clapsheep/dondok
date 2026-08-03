package com.dondok.auth.infrastructure.persistence;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUserEntity, UUID> {
    boolean existsByEmailNormalized(String emailNormalized);

    Optional<AppUserEntity> findByEmailNormalized(String emailNormalized);
}
