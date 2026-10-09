package com.dondok.membership.infrastructure.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface LedgerMemberRepository extends JpaRepository<LedgerMemberEntity, UUID> {
    @Query("select m from LedgerMemberEntity m, AppUserEntity u where m.userId = :userId and u.id = m.userId and u.status = com.dondok.auth.domain.UserStatus.ACTIVE")
    Optional<LedgerMemberEntity> findByUserId(UUID userId);

    boolean existsByUserId(UUID userId);

    Optional<LedgerMemberEntity> findByIdAndBookId(UUID id, UUID bookId);

    @Query("select m from LedgerMemberEntity m, AppUserEntity u where m.id = :id and m.bookId = :bookId and u.id = m.userId and u.status = com.dondok.auth.domain.UserStatus.ACTIVE")
    Optional<LedgerMemberEntity> findActiveByIdAndBookId(UUID id, UUID bookId);

    List<LedgerMemberEntity> findAllByBookIdOrderByJoinedAtAscIdAsc(UUID bookId);
}
