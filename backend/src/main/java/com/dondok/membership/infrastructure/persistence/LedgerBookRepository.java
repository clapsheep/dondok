package com.dondok.membership.infrastructure.persistence;

import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LedgerBookRepository extends JpaRepository<LedgerBookEntity, UUID> {
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select book from LedgerBookEntity book where book.id = :id")
    java.util.Optional<LedgerBookEntity> findByIdForShare(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select book from LedgerBookEntity book where book.id = :id")
    java.util.Optional<LedgerBookEntity> findByIdForUpdate(@Param("id") UUID id);
}
