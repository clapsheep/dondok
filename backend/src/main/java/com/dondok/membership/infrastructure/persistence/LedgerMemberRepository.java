package com.dondok.membership.infrastructure.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LedgerMemberRepository extends JpaRepository<LedgerMemberEntity, UUID> {
    Optional<LedgerMemberEntity> findByUserId(UUID userId);

    boolean existsByUserId(UUID userId);

    Optional<LedgerMemberEntity> findByIdAndBookId(UUID id, UUID bookId);

    List<LedgerMemberEntity> findAllByBookIdOrderByJoinedAtAscIdAsc(UUID bookId);
}
