package com.dondok.asset.application;

import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.asset.infrastructure.persistence.AssetEntity;
import com.dondok.asset.infrastructure.persistence.AssetRepository;
import com.dondok.asset.infrastructure.persistence.AssetTypeEntity;
import com.dondok.asset.infrastructure.persistence.AssetTypeRepository;
import com.dondok.asset.infrastructure.persistence.CardSettingEntity;
import com.dondok.asset.infrastructure.persistence.CardSettingRepository;
import com.dondok.asset.infrastructure.persistence.DebitCardSettingEntity;
import com.dondok.asset.infrastructure.persistence.DebitCardSettingRepository;
import com.dondok.common.id.UuidV7;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class DefaultAssetBootstrapService {

    private static final short DEFAULT_CARD_CLOSING_DAY = 14;
    private static final short DEFAULT_CARD_PAYMENT_DAY = 25;
    private static final short DEFAULT_CARD_PAYMENT_MONTH_OFFSET = 1;

    private final AssetRepository assets;
    private final AssetTypeRepository assetTypes;
    private final CardSettingRepository cardSettings;
    private final DebitCardSettingRepository debitCardSettings;

    public DefaultAssetBootstrapService(
            AssetRepository assets,
            AssetTypeRepository assetTypes,
            CardSettingRepository cardSettings,
            DebitCardSettingRepository debitCardSettings
    ) {
        this.assets = assets;
        this.assetTypes = assetTypes;
        this.cardSettings = cardSettings;
        this.debitCardSettings = debitCardSettings;
    }

    public void bootstrap(UUID bookId, UUID creatorMemberId, LocalDate openedOn, Instant now) {
        AssetEntity cash = defaultAsset(
                bookId, creatorMemberId, type(bookId, "CASH"), "현금", openedOn, now);
        AssetEntity account = defaultAsset(
                bookId, creatorMemberId, type(bookId, "BANK"), "계좌", openedOn, now);
        AssetEntity creditCard = defaultAsset(
                bookId, creatorMemberId, type(bookId, "CREDIT_CARD"), "신용카드", openedOn, now);
        AssetEntity debitCard = defaultAsset(
                bookId, creatorMemberId, type(bookId, "DEBIT_CARD"), "체크카드", openedOn, now);

        assets.saveAll(List.of(cash, account, creditCard, debitCard));
        assets.flush();

        cardSettings.save(new CardSettingEntity(
                creditCard.getId(),
                bookId,
                DEFAULT_CARD_CLOSING_DAY,
                DEFAULT_CARD_PAYMENT_DAY,
                DEFAULT_CARD_PAYMENT_MONTH_OFFSET,
                account.getId(),
                false,
                now));
        debitCardSettings.save(new DebitCardSettingEntity(
                debitCard.getId(), bookId, account.getId(), now));
        cardSettings.flush();
        debitCardSettings.flush();
    }

    private AssetEntity defaultAsset(
            UUID bookId,
            UUID creatorMemberId,
            AssetTypeEntity assetType,
            String name,
            LocalDate openedOn,
            Instant now
    ) {
        return new AssetEntity(
                UuidV7.next(),
                bookId,
                assetType.getId(),
                AssetOwnershipScope.PERSONAL,
                creatorMemberId,
                name,
                openedOn,
                null,
                0,
                assetType.getSortOrder(),
                creatorMemberId,
                now);
    }

    private AssetTypeEntity type(UUID bookId, String systemCode) {
        return assetTypes.findByBookIdAndSystemCodeAndArchivedAtIsNull(bookId, systemCode)
                .orElseThrow(() -> new IllegalStateException(
                        "Default asset type was not bootstrapped: " + systemCode));
    }
}
