alter table asset
    drop constraint ck_asset_financial_institution_code;

alter table asset
    add constraint ck_asset_financial_institution_code
    check (
        financial_institution_code is null
        or financial_institution_code in (
            'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'HANA', 'WOORI', 'NH', 'IBK',
            'KAKAO_BANK', 'K_BANK', 'TOSS_BANK', 'SC', 'CITI', 'KDB', 'SUHYUP',
            'POST_OFFICE', 'MG', 'CREDIT_UNION', 'SAVINGS_BANK', 'BNK_BUSAN',
            'BNK_GYEONGNAM', 'IM_BANK', 'GWANGJU', 'JEONBUK', 'JEJU',
            'HYUNDAI_CAPITAL', 'KB_CAPITAL', 'SHINHAN_CAPITAL', 'HANA_CAPITAL',
            'WOORI_FINANCIAL_CAPITAL', 'NH_CAPITAL', 'LOTTE_CAPITAL', 'BNK_CAPITAL',
            'JB_WOORI_CAPITAL', 'MIRAE_ASSET_SEC', 'KOREA_INVESTMENT_SEC',
            'NH_INVESTMENT_SEC', 'SAMSUNG_SEC', 'KB_SEC', 'KIWOOM_SEC',
            'SHINHAN_SEC', 'HANA_SEC', 'MERITZ_SEC', 'DAISHIN_SEC', 'HANWHA_SEC',
            'HYUNDAI_MOTOR_SEC', 'DB_SEC', 'YUANTA_SEC', 'EUGENE_SEC', 'SK_SEC',
            'IBK_SEC', 'KAKAO_PAY_SEC', 'TOSS_SEC', 'LS_SEC', 'SHINYOUNG_SEC'
        )
    );

update asset a
set financial_institution_code = 'OTHER'
from asset_type at
where a.asset_type_id = at.id
  and a.book_id = at.book_id
  and at.system_code in ('LOAN', 'INVESTMENT')
  and a.financial_institution_code is null;

comment on column asset.financial_institution_code is
    'BANK/SAVINGS/LOAN 금융기관 또는 INVESTMENT 증권사 정적 코드';
