create index ix_ledger_transaction_monthly_activity
    on ledger_transaction(book_id, occurred_on, transaction_type)
    include (amount_won)
    where deleted_at is null
      and transaction_type in ('INCOME', 'EXPENSE');

with default_category (
    kind,
    system_code,
    is_fallback,
    name,
    sort_order
) as (
    values
        ('INCOME',  'OTHER',        true,  '기타 수입',  10),
        ('EXPENSE', 'FOOD',         false, '식비',       10),
        ('EXPENSE', 'TRANSPORT',    false, '교통비',     20),
        ('EXPENSE', 'GROCERIES',    false, '장보기',     30),
        ('EXPENSE', 'HOUSING',      false, '주거비',     40),
        ('EXPENSE', 'TELECOM',      false, '통신비',     50),
        ('EXPENSE', 'FAMILY_EVENT', false, '경조사비',   60),
        ('EXPENSE', 'EDUCATION',    false, '교육비',     70),
        ('EXPENSE', 'MEDICAL',      false, '의료비',     80),
        ('EXPENSE', 'SUBSCRIPTION', false, '구독비',     90),
        ('EXPENSE', 'HOUSEHOLD',    false, '생필품',    100),
        ('EXPENSE', 'LEISURE',      false, '여가생활',  110),
        ('EXPENSE', 'OTHER',        true,  '기타 지출', 120)
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
insert into category (
    id,
    book_id,
    kind,
    system_code,
    is_fallback,
    name,
    sort_order,
    created_by_member_id,
    updated_by_member_id
)
select
    uuidv7(),
    ledger_creator.book_id,
    default_category.kind,
    default_category.system_code,
    default_category.is_fallback,
    default_category.name,
    default_category.sort_order,
    ledger_creator.creator_member_id,
    ledger_creator.creator_member_id
from ledger_creator
cross join default_category
where not exists (
    select 1
    from category
    where category.book_id = ledger_creator.book_id
      and category.kind = default_category.kind
      and category.system_code = default_category.system_code
);
