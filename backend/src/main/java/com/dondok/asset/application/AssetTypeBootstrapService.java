package com.dondok.asset.application;

import com.dondok.asset.domain.DefaultAssetType;
import com.dondok.asset.infrastructure.persistence.AssetTypeEntity;
import com.dondok.asset.infrastructure.persistence.AssetTypeRepository;
import com.dondok.common.id.UuidV7;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class AssetTypeBootstrapService {
    private final AssetTypeRepository assetTypes;

    public AssetTypeBootstrapService(AssetTypeRepository assetTypes) {
        this.assetTypes = assetTypes;
    }

    public void bootstrap(UUID bookId, UUID creatorMemberId, Instant now) {
        for (DefaultAssetType type : DefaultAssetType.ALL) {
            if (assetTypes.findByBookIdAndSystemCodeAndArchivedAtIsNull(bookId, type.systemCode()).isEmpty()) {
                assetTypes.save(new AssetTypeEntity(
                        UuidV7.next(), bookId, type.systemCode(), type.name(), type.behavior(),
                        type.paymentSourceCapable(), type.sortOrder(), creatorMemberId, now));
            }
        }
        assetTypes.flush();
    }
}
