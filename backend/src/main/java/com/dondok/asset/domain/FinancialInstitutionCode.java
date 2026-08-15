package com.dondok.asset.domain;

public enum FinancialInstitutionCode {
    OTHER,
    KB_KOOKMIN,
    SHINHAN,
    HANA,
    WOORI,
    NH,
    IBK,
    KAKAO_BANK,
    K_BANK,
    TOSS_BANK,
    SC,
    CITI,
    KDB,
    SUHYUP,
    POST_OFFICE,
    MG,
    CREDIT_UNION,
    SAVINGS_BANK,
    BNK_BUSAN,
    BNK_GYEONGNAM,
    IM_BANK,
    GWANGJU,
    JEONBUK,
    JEJU,
    HYUNDAI_CAPITAL,
    KB_CAPITAL,
    SHINHAN_CAPITAL,
    HANA_CAPITAL,
    WOORI_FINANCIAL_CAPITAL,
    NH_CAPITAL,
    LOTTE_CAPITAL,
    BNK_CAPITAL,
    JB_WOORI_CAPITAL,
    MIRAE_ASSET_SEC,
    KOREA_INVESTMENT_SEC,
    NH_INVESTMENT_SEC,
    SAMSUNG_SEC,
    KB_SEC,
    KIWOOM_SEC,
    SHINHAN_SEC,
    HANA_SEC,
    MERITZ_SEC,
    DAISHIN_SEC,
    HANWHA_SEC,
    HYUNDAI_MOTOR_SEC,
    DB_SEC,
    YUANTA_SEC,
    EUGENE_SEC,
    SK_SEC,
    IBK_SEC,
    KAKAO_PAY_SEC,
    TOSS_SEC,
    LS_SEC,
    SHINYOUNG_SEC;

    private static final java.util.Set<FinancialInstitutionCode> CAPITAL_CODES = java.util.EnumSet.of(
            HYUNDAI_CAPITAL, KB_CAPITAL, SHINHAN_CAPITAL, HANA_CAPITAL,
            WOORI_FINANCIAL_CAPITAL, NH_CAPITAL, LOTTE_CAPITAL, BNK_CAPITAL, JB_WOORI_CAPITAL);
    private static final java.util.Set<FinancialInstitutionCode> SECURITIES_CODES = java.util.EnumSet.of(
            MIRAE_ASSET_SEC, KOREA_INVESTMENT_SEC, NH_INVESTMENT_SEC, SAMSUNG_SEC,
            KB_SEC, KIWOOM_SEC, SHINHAN_SEC, HANA_SEC, MERITZ_SEC, DAISHIN_SEC,
            HANWHA_SEC, HYUNDAI_MOTOR_SEC, DB_SEC, YUANTA_SEC, EUGENE_SEC, SK_SEC,
            IBK_SEC, KAKAO_PAY_SEC, TOSS_SEC, LS_SEC, SHINYOUNG_SEC);

    public boolean supports(String assetSystemCode) {
        if (this == OTHER) {
            return java.util.Set.of("BANK", "SAVINGS", "LOAN", "INVESTMENT").contains(assetSystemCode);
        }
        return switch (assetSystemCode) {
            case "BANK", "SAVINGS" -> !CAPITAL_CODES.contains(this) && !SECURITIES_CODES.contains(this);
            case "LOAN" -> !SECURITIES_CODES.contains(this);
            case "INVESTMENT" -> SECURITIES_CODES.contains(this);
            default -> false;
        };
    }
}
