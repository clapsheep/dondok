with default_asset_type (
    system_code,
    name,
    behavior,
    payment_source_capable,
    sort_order
) as (
    values
        ('CASH',        '현금',          'STANDARD',    false,  10),
        ('BANK',        '은행',          'STANDARD',    true,   20),
        ('CREDIT_CARD', '신용카드',      'CREDIT_CARD', false,  30),
        ('DEBIT_CARD',  '체크카드',      'STANDARD',    false,  40),
        ('SAVINGS',     '저축',          'STANDARD',    true,   50),
        ('INVESTMENT',  '투자',          'STANDARD',    false,  60),
        ('OVERDRAFT',   '마이너스 통장', 'STANDARD',    true,   70),
        ('LOAN',        '대출',          'STANDARD',    false,  80),
        ('INSURANCE',   '보험',          'STANDARD',    false,  90),
        ('OTHER',       '기타',          'STANDARD',    false, 100)
), ledger_creator as (
    select
        ledger_book.id as book_id,
        creator_member.id as creator_member_id
    from ledger_book
    join lateral (
        select ledger_member.id
        from ledger_member
        where ledger_member.book_id = ledger_book.id
        order by ledger_member.joined_at, ledger_member.id
        limit 1
    ) creator_member on true
)
insert into asset_type (
    id,
    book_id,
    system_code,
    name,
    behavior,
    payment_source_capable,
    is_custom,
    sort_order,
    created_by_member_id
)
select
    uuidv7(),
    ledger_creator.book_id,
    default_asset_type.system_code,
    default_asset_type.name,
    default_asset_type.behavior,
    default_asset_type.payment_source_capable,
    false,
    default_asset_type.sort_order,
    ledger_creator.creator_member_id
from ledger_creator
cross join default_asset_type
where not exists (
    select 1
    from asset_type
    where asset_type.book_id = ledger_creator.book_id
      and asset_type.system_code = default_asset_type.system_code
);
