package com.dondok.asset.infrastructure.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssetRepository extends JpaRepository<AssetEntity, UUID> {
    List<AssetEntity> findAllByBookIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(UUID bookId);
    List<AssetEntity> findAllByBookIdAndArchivedAtIsNotNullOrderBySortOrderAscIdAsc(UUID bookId);
    List<AssetEntity> findAllByBookIdOrderBySortOrderAscIdAsc(UUID bookId);
    Optional<AssetEntity> findByIdAndBookId(UUID id, UUID bookId);
    Optional<AssetEntity> findByIdAndBookIdAndArchivedAtIsNull(UUID id, UUID bookId);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select asset from AssetEntity asset where asset.id = :id and asset.bookId = :bookId and asset.archivedAt is null")
    Optional<AssetEntity> findActiveForRead(@Param("id") UUID id, @Param("bookId") UUID bookId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select asset from AssetEntity asset where asset.id = :id and asset.bookId = :bookId and asset.archivedAt is null")
    Optional<AssetEntity> findActiveForUpdate(@Param("id") UUID id, @Param("bookId") UUID bookId);
    long countByBookIdAndArchivedAtIsNull(UUID bookId);
    boolean existsByBookIdAndNameIgnoreCaseAndArchivedAtIsNull(UUID bookId, String name);
    boolean existsByBookIdAndNameIgnoreCaseAndArchivedAtIsNullAndIdNot(UUID bookId, String name, UUID id);
}
