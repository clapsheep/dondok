alter table asset
    add column card_issuer_code varchar(40);

update asset a
set card_issuer_code = 'OTHER'
from asset_type at
where a.asset_type_id = at.id
  and a.book_id = at.book_id
  and at.system_code in ('CREDIT_CARD', 'DEBIT_CARD');

alter table asset
    add constraint ck_asset_card_issuer_code
    check (
        card_issuer_code is null
        or card_issuer_code in (
            'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'SAMSUNG', 'HYUNDAI', 'LOTTE',
            'WOORI', 'HANA', 'BC', 'NH'
        )
    );

create index ix_asset_book_card_issuer_active
    on asset(book_id, card_issuer_code, sort_order, id)
    where archived_at is null and card_issuer_code is not null;
