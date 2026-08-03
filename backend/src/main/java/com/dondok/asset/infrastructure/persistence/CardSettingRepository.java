package com.dondok.asset.infrastructure.persistence;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CardSettingRepository extends JpaRepository<CardSettingEntity, UUID> {
    List<CardSettingEntity> findAllByCardAssetIdIn(List<UUID> assetIds);
    boolean existsBySettlementAssetId(UUID assetId);
}
