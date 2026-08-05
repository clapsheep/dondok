package com.dondok.asset.domain;

import java.util.List;

public record DefaultAssetType(
        String systemCode,
        String name,
        AssetBehavior behavior,
        boolean paymentSourceCapable,
        int sortOrder
) {
    public static final List<DefaultAssetType> ALL = List.of(
            new DefaultAssetType("CASH", "현금", AssetBehavior.STANDARD, false, 10),
            new DefaultAssetType("BANK", "계좌", AssetBehavior.STANDARD, true, 20),
            new DefaultAssetType("CREDIT_CARD", "신용카드", AssetBehavior.CREDIT_CARD, false, 30),
            new DefaultAssetType("DEBIT_CARD", "체크카드", AssetBehavior.DEBIT_CARD, false, 40),
            new DefaultAssetType("SAVINGS", "적금", AssetBehavior.SAVINGS, true, 50),
            new DefaultAssetType("INVESTMENT", "투자", AssetBehavior.STANDARD, false, 60),
            new DefaultAssetType("LOAN", "대출", AssetBehavior.STANDARD, false, 80),
            new DefaultAssetType("INSURANCE", "보험", AssetBehavior.STANDARD, false, 90),
            new DefaultAssetType("OTHER", "기타", AssetBehavior.STANDARD, false, 100));
}
