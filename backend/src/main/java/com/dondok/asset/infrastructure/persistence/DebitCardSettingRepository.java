package com.dondok.asset.infrastructure.persistence;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DebitCardSettingRepository extends JpaRepository<DebitCardSettingEntity, UUID> {
    List<DebitCardSettingEntity> findAllByDebitCardAssetIdIn(Collection<UUID> assetIds);
    boolean existsByPaymentAssetId(UUID assetId);
}
