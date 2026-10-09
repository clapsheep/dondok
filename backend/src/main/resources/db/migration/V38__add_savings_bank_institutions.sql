alter table asset drop constraint ck_asset_financial_institution_code;

alter table asset add constraint ck_asset_financial_institution_code
    check (financial_institution_code is null or financial_institution_code in (
        'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'HANA', 'WOORI',
        'NH', 'IBK', 'KAKAO_BANK', 'K_BANK', 'TOSS_BANK',
        'SC', 'CITI', 'KDB', 'SUHYUP', 'POST_OFFICE',
        'MG', 'CREDIT_UNION', 'SAVINGS_BANK', 'BNK_BUSAN', 'BNK_GYEONGNAM',
        'IM_BANK', 'GWANGJU', 'JEONBUK', 'JEJU', 'HYUNDAI_CAPITAL',
        'KB_CAPITAL', 'SHINHAN_CAPITAL', 'HANA_CAPITAL', 'WOORI_FINANCIAL_CAPITAL', 'NH_CAPITAL',
        'LOTTE_CAPITAL', 'BNK_CAPITAL', 'JB_WOORI_CAPITAL', 'MIRAE_ASSET_SEC', 'KOREA_INVESTMENT_SEC',
        'NH_INVESTMENT_SEC', 'SAMSUNG_SEC', 'KB_SEC', 'KIWOOM_SEC', 'SHINHAN_SEC',
        'HANA_SEC', 'MERITZ_SEC', 'DAISHIN_SEC', 'HANWHA_SEC', 'HYUNDAI_MOTOR_SEC',
        'DB_SEC', 'YUANTA_SEC', 'EUGENE_SEC', 'SK_SEC', 'IBK_SEC',
        'KAKAO_PAY_SEC', 'TOSS_SEC', 'LS_SEC', 'SHINYOUNG_SEC', 'SB_DAOL',
        'SB_DAISHIN', 'SB_THE_K', 'SB_MINKUK', 'SB_BARO', 'SB_SKY',
        'SB_SHINHAN', 'SB_ACUON', 'SB_YEGARAM', 'SB_WELCOME', 'SB_YUANTA',
        'SB_CHOEUN', 'SB_KIWOOM_YES', 'SB_PUREUN', 'SB_HANA', 'SB_DB',
        'SB_HB', 'SB_JT_CHINAE', 'SB_KB', 'SB_NH', 'SB_OK',
        'SB_OSB', 'SB_SBI', 'SB_KUEMHWA', 'SB_NAMYANG', 'SB_MOA',
        'SB_BULIM', 'SB_SAMJUNG', 'SB_SANGSANGIN', 'SB_SERAM', 'SB_ANGUK',
        'SB_ANYANG', 'SB_YOUNGJIN', 'SB_YUNGCHANG', 'SB_INSUNG', 'SB_INCHEON',
        'SB_KIWOOM', 'SB_PEPPER', 'SB_PYEONGTAEK', 'SB_KOREA_INVESTMENT', 'SB_HANWHA',
        'SB_JT', 'SB_GORYO', 'SB_KUKJE', 'SB_DONGWON_JEIL', 'SB_SOULBRAIN',
        'SB_SNT', 'SB_WOOLEE', 'SB_CHOHUNG', 'SB_JINJU', 'SB_HEUNGKUK',
        'SB_BNK', 'SB_DH', 'SB_IBK', 'SB_DEBEC', 'SB_DAEA',
        'SB_DAEWON', 'SB_DREAM', 'SB_RAON', 'SB_MUST_SAMIL', 'SB_MS',
        'SB_OSUNG', 'SB_UNION', 'SB_CHARM', 'SB_CK', 'SB_DAEHAN',
        'SB_DONGYANG', 'SB_LINE', 'SB_SAMHO', 'SB_CENTRAL', 'SB_SMART',
        'SB_STAR', 'SB_DAEMYUNG', 'SB_SANGSANGIN_PLUS', 'SB_ASAN', 'SB_O2',
        'SB_WOORI_FINANCIAL', 'SB_CHEONGJU', 'SB_HANSUNG'
    ));
