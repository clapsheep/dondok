alter table asset
    add column financial_institution_code varchar(40);

update asset a
set financial_institution_code = 'OTHER'
from asset_type at
where a.asset_type_id = at.id
  and a.book_id = at.book_id
  and at.system_code in ('BANK', 'SAVINGS');

alter table asset
    add constraint ck_asset_financial_institution_code
    check (
        financial_institution_code is null
        or financial_institution_code in (
            'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'HANA', 'WOORI', 'NH', 'IBK',
            'KAKAO_BANK', 'K_BANK', 'TOSS_BANK', 'SC', 'CITI', 'KDB', 'SUHYUP',
            'POST_OFFICE', 'MG', 'CREDIT_UNION', 'SAVINGS_BANK', 'BNK_BUSAN',
            'BNK_GYEONGNAM', 'IM_BANK', 'GWANGJU', 'JEONBUK', 'JEJU'
        )
    );

create index ix_asset_book_financial_institution_active
    on asset(book_id, financial_institution_code, sort_order, id)
    where archived_at is null and financial_institution_code is not null;
