package com.dondok.asset.infrastructure.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetTypeRepository extends JpaRepository<AssetTypeEntity, UUID> {
    List<AssetTypeEntity> findAllByBookIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(UUID bookId);
    Optional<AssetTypeEntity> findByIdAndBookIdAndArchivedAtIsNull(UUID id, UUID bookId);
    Optional<AssetTypeEntity> findByBookIdAndSystemCodeAndArchivedAtIsNull(UUID bookId, String systemCode);
}
