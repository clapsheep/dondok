package com.dondok.asset.infrastructure.persistence;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SavingsSettingRepository extends JpaRepository<SavingsSettingEntity, UUID> {
    List<SavingsSettingEntity> findAllBySavingsAssetIdIn(Collection<UUID> assetIds);
    boolean existsByTransferAssetId(UUID assetId);
}
