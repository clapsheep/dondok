package com.dondok.asset.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "card_setting")
public class CardSettingEntity {
    @Id @Column(name = "card_asset_id") private UUID cardAssetId;
    @Column(name = "book_id", nullable = false) private UUID bookId;
    @Column(name = "statement_closing_day", nullable = false) private short statementClosingDay;
    @Column(name = "payment_day", nullable = false) private short paymentDay;
    @Column(name = "payment_month_offset", nullable = false) private short paymentMonthOffset;
    @Column(name = "settlement_asset_id") private UUID settlementAssetId;
    @Column(name = "auto_settlement_enabled", nullable = false) private boolean autoSettlementEnabled;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private Long version;

    protected CardSettingEntity() {
    }

    public CardSettingEntity(UUID assetId, UUID bookId, short closingDay, short paymentDay,
                             short paymentMonthOffset, UUID settlementAssetId,
                             boolean autoSettlementEnabled, Instant now) {
        this.cardAssetId = assetId;
        this.bookId = bookId;
        this.statementClosingDay = closingDay;
        this.paymentDay = paymentDay;
        this.paymentMonthOffset = paymentMonthOffset;
        this.settlementAssetId = settlementAssetId;
        this.autoSettlementEnabled = autoSettlementEnabled;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(short closingDay, short paymentDay, short paymentMonthOffset,
                       UUID settlementAssetId, boolean autoSettlementEnabled, Instant now) {
        this.statementClosingDay = closingDay;
        this.paymentDay = paymentDay;
        this.paymentMonthOffset = paymentMonthOffset;
        this.settlementAssetId = settlementAssetId;
        this.autoSettlementEnabled = autoSettlementEnabled;
        this.updatedAt = now;
    }

    public UUID getCardAssetId() { return cardAssetId; }
    public short getStatementClosingDay() { return statementClosingDay; }
    public short getPaymentDay() { return paymentDay; }
    public short getPaymentMonthOffset() { return paymentMonthOffset; }
    public UUID getSettlementAssetId() { return settlementAssetId; }
    public boolean isAutoSettlementEnabled() { return autoSettlementEnabled; }
}
