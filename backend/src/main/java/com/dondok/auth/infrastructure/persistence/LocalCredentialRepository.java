package com.dondok.auth.infrastructure.persistence;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LocalCredentialRepository extends JpaRepository<LocalCredentialEntity, UUID> {
    boolean existsByLoginIdNormalized(String loginIdNormalized);

    @EntityGraph(attributePaths = "user")
    Optional<LocalCredentialEntity> findByLoginIdNormalized(String loginIdNormalized);
}
