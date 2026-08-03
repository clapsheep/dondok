\set ON_ERROR_STOP on

-- Apply after V1, V2, V4__transaction_seed_fixture.sql, V3 and V4.
do $$
declare
    category_count bigint;
    expense_count bigint;
    income_count bigint;
    fallback_count bigint;
    food_name varchar(100);
    monthly_index_count bigint;
begin
    select count(*)
      into category_count
      from category
     where book_id = '00000000-0000-7000-8000-000000000310';

    select count(*)
      into expense_count
      from category
     where book_id = '00000000-0000-7000-8000-000000000310'
       and kind = 'EXPENSE';

    select count(*)
      into income_count
      from category
     where book_id = '00000000-0000-7000-8000-000000000310'
       and kind = 'INCOME';

    select count(*)
      into fallback_count
      from category
     where book_id = '00000000-0000-7000-8000-000000000310'
       and is_fallback;

    select name
      into food_name
      from category
     where book_id = '00000000-0000-7000-8000-000000000310'
       and kind = 'EXPENSE'
       and system_code = 'FOOD';

    select count(*)
      into monthly_index_count
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'ledger_transaction'
       and indexname = 'ix_ledger_transaction_monthly_activity'
       and indexdef ilike '%include (amount_won)%'
       and indexdef ilike '%transaction_type%income%expense%';

    if category_count <> 13
       or expense_count <> 12
       or income_count <> 1
       or fallback_count <> 2
       or food_name <> '외식과 식비'
       or monthly_index_count <> 1 then
        raise exception
            'unexpected category seed total=%, expense=%, income=%, fallback=%, food=%, index=%',
            category_count,
            expense_count,
            income_count,
            fallback_count,
            food_name,
            monthly_index_count;
    end if;
end;
$$;

begin;

insert into asset (
    id,
    book_id,
    asset_type_id,
    ownership_scope,
    owner_member_id,
    name,
    opened_on,
    created_by_member_id,
    updated_by_member_id
)
values
    (
        '00000000-0000-7000-8000-000000000341',
        '00000000-0000-7000-8000-000000000310',
        (
            select id from asset_type
             where book_id = '00000000-0000-7000-8000-000000000310'
               and system_code = 'BANK'
        ),
        'PERSONAL',
        '00000000-0000-7000-8000-000000000321',
        '생활비 계좌',
        '2026-07-01',
        '00000000-0000-7000-8000-000000000321',
        '00000000-0000-7000-8000-000000000321'
    ),
    (
        '00000000-0000-7000-8000-000000000342',
        '00000000-0000-7000-8000-000000000310',
        (
            select id from asset_type
             where book_id = '00000000-0000-7000-8000-000000000310'
               and system_code = 'CASH'
        ),
        'JOINT',
        null,
        '공동 현금',
        '2026-06-30',
        '00000000-0000-7000-8000-000000000322',
        '00000000-0000-7000-8000-000000000322'
    );

insert into ledger_transaction (
    id,
    book_id,
    transaction_type,
    transfer_subtype,
    occurred_on,
    amount_won,
    category_id,
    performed_by_member_id,
    description,
    source_type,
    source_id,
    created_by_member_id,
    updated_by_member_id,
    created_at,
    updated_at,
    deleted_by_member_id,
    deleted_at
)
values
    (
        '00000000-0000-7000-8000-000000000351',
        '00000000-0000-7000-8000-000000000310',
        'ADJUSTMENT', null, '2026-07-01', 1000, null, null,
        '최초 금액', 'OPENING_BALANCE',
        '00000000-0000-7000-8000-000000000341',
        '00000000-0000-7000-8000-000000000321',
        '00000000-0000-7000-8000-000000000321',
        '2026-07-01T08:00:00Z', '2026-07-01T08:00:00Z', null, null
    ),
    (
        '00000000-0000-7000-8000-000000000352',
        '00000000-0000-7000-8000-000000000310',
        'INCOME', null, '2026-07-01', 100000,
        (
            select id from category
             where book_id = '00000000-0000-7000-8000-000000000310'
               and kind = 'INCOME' and system_code = 'OTHER'
        ),
        '00000000-0000-7000-8000-000000000321',
        '생활비 입금', 'MANUAL', null,
        '00000000-0000-7000-8000-000000000322',
        '00000000-0000-7000-8000-000000000322',
        '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z', null, null
    ),
    (
        '00000000-0000-7000-8000-000000000353',
        '00000000-0000-7000-8000-000000000310',
        'EXPENSE', null, '2026-07-01', 20000,
        '00000000-0000-7000-8000-000000000331',
        '00000000-0000-7000-8000-000000000322',
        '장보기', 'MANUAL', null,
        '00000000-0000-7000-8000-000000000321',
        '00000000-0000-7000-8000-000000000321',
        '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z', null, null
    ),
    (
        '00000000-0000-7000-8000-000000000354',
        '00000000-0000-7000-8000-000000000310',
        'TRANSFER', 'NORMAL', '2026-07-02', 30000, null,
        '00000000-0000-7000-8000-000000000321',
        '공동 현금으로 이동', 'MANUAL', null,
        '00000000-0000-7000-8000-000000000321',
        '00000000-0000-7000-8000-000000000321',
        '2026-07-02T11:00:00Z', '2026-07-02T11:00:00Z', null, null
    ),
    (
        '00000000-0000-7000-8000-000000000355',
        '00000000-0000-7000-8000-000000000310',
        'EXPENSE', null, '2026-07-02', 5000,
        (
            select id from category
             where book_id = '00000000-0000-7000-8000-000000000310'
               and kind = 'EXPENSE' and system_code = 'GROCERIES'
        ),
        '00000000-0000-7000-8000-000000000321',
        '삭제한 장보기', 'MANUAL', null,
        '00000000-0000-7000-8000-000000000322',
        '00000000-0000-7000-8000-000000000322',
        '2026-07-02T12:00:00Z', '2026-07-02T12:00:00Z',
        '00000000-0000-7000-8000-000000000322', '2026-07-02T12:30:00Z'
    ),
    (
        '00000000-0000-7000-8000-000000000356',
        '00000000-0000-7000-8000-000000000310',
        'INCOME', null, '2026-07-02', 10000,
        (
            select id from category
             where book_id = '00000000-0000-7000-8000-000000000310'
               and kind = 'INCOME' and system_code = 'OTHER'
        ),
        '00000000-0000-7000-8000-000000000322',
        '공동 현금 입금', 'MANUAL', null,
        '00000000-0000-7000-8000-000000000321',
        '00000000-0000-7000-8000-000000000321',
        '2026-07-02T13:00:00Z', '2026-07-02T13:00:00Z', null, null
    ),
    (
        '00000000-0000-7000-8000-000000000357',
        '00000000-0000-7000-8000-000000000310',
        'EXPENSE', null, '2026-08-01', 1000,
        '00000000-0000-7000-8000-000000000331',
        '00000000-0000-7000-8000-000000000321',
        '다음 달 지출', 'MANUAL', null,
        '00000000-0000-7000-8000-000000000321',
        '00000000-0000-7000-8000-000000000321',
        '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z', null, null
    );

insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
values
    ('00000000-0000-7000-8000-000000000351', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000341', 1000),
    ('00000000-0000-7000-8000-000000000352', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000341', 100000),
    ('00000000-0000-7000-8000-000000000353', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000341', -20000),
    ('00000000-0000-7000-8000-000000000354', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000341', -30000),
    ('00000000-0000-7000-8000-000000000354', 2, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000342', 30000),
    ('00000000-0000-7000-8000-000000000355', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000341', -5000),
    ('00000000-0000-7000-8000-000000000356', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000342', 10000),
    ('00000000-0000-7000-8000-000000000357', 1, '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000341', -1000);

-- Transfers cannot carry a category.
do $$
begin
    begin
        insert into ledger_transaction (
            id, book_id, transaction_type, transfer_subtype, occurred_on,
            amount_won, category_id, performed_by_member_id,
            created_by_member_id, updated_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000358',
            '00000000-0000-7000-8000-000000000310',
            'TRANSFER', 'NORMAL', '2026-07-03', 1,
            '00000000-0000-7000-8000-000000000331',
            '00000000-0000-7000-8000-000000000321',
            '00000000-0000-7000-8000-000000000321',
            '00000000-0000-7000-8000-000000000321'
        );
        raise exception 'transfer category was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

do $$
declare
    july_first_income bigint;
    july_first_expense bigint;
    july_second_income bigint;
    july_second_expense bigint;
    july_row_count bigint;
    cursor_page text;
    bank_balance bigint;
    cash_balance bigint;
begin
    select
        coalesce(sum(amount_won) filter (where transaction_type = 'INCOME'), 0),
        coalesce(sum(amount_won) filter (where transaction_type = 'EXPENSE'), 0)
      into july_first_income, july_first_expense
      from ledger_transaction
     where book_id = '00000000-0000-7000-8000-000000000310'
       and occurred_on = '2026-07-01'
       and transaction_type in ('INCOME', 'EXPENSE')
       and deleted_at is null;

    select
        coalesce(sum(amount_won) filter (where transaction_type = 'INCOME'), 0),
        coalesce(sum(amount_won) filter (where transaction_type = 'EXPENSE'), 0)
      into july_second_income, july_second_expense
      from ledger_transaction
     where book_id = '00000000-0000-7000-8000-000000000310'
       and occurred_on = '2026-07-02'
       and transaction_type in ('INCOME', 'EXPENSE')
       and deleted_at is null;

    select count(*)
      into july_row_count
      from ledger_transaction
     where book_id = '00000000-0000-7000-8000-000000000310'
       and occurred_on >= '2026-07-01'
       and occurred_on < '2026-08-01'
       and transaction_type in ('INCOME', 'EXPENSE', 'TRANSFER')
       and deleted_at is null;

    select string_agg(id::text, ',' order by occurred_on desc, created_at desc, id desc)
      into cursor_page
      from (
          select id, occurred_on, created_at
            from ledger_transaction
           where book_id = '00000000-0000-7000-8000-000000000310'
             and occurred_on >= '2026-07-01'
             and occurred_on < '2026-08-01'
             and transaction_type in ('INCOME', 'EXPENSE', 'TRANSFER')
             and deleted_at is null
             and (occurred_on, created_at, id) < (
                 '2026-07-02'::date,
                 '2026-07-02T11:00:00Z'::timestamptz,
                 '00000000-0000-7000-8000-000000000354'::uuid
             )
           order by occurred_on desc, created_at desc, id desc
           limit 10
      ) page;

    select current_balance_won
      into bank_balance
      from asset_current_balance
     where asset_id = '00000000-0000-7000-8000-000000000341';

    select current_balance_won
      into cash_balance
      from asset_current_balance
     where asset_id = '00000000-0000-7000-8000-000000000342';

    if july_first_income <> 100000
       or july_first_expense <> 20000
       or july_second_income <> 10000
       or july_second_expense <> 0
       or july_row_count <> 4
       or cursor_page <> '00000000-0000-7000-8000-000000000353,00000000-0000-7000-8000-000000000352'
       or bank_balance <> 50000
       or cash_balance <> 40000 then
        raise exception
            'unexpected transaction state d1=%/% d2=%/% rows=% cursor=% bank=% cash=%',
            july_first_income,
            july_first_expense,
            july_second_income,
            july_second_expense,
            july_row_count,
            cursor_page,
            bank_balance,
            cash_balance;
    end if;
end;
$$;

rollback;
