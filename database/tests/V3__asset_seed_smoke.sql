\set ON_ERROR_STOP on

-- Apply after V1, V2, V3__asset_seed_fixture.sql and V3 in a disposable database.

do $$
declare
    system_type_count bigint;
    settlement_type_count bigint;
    credit_behavior_count bigint;
    bank_name varchar(100);
begin
    select count(*)
      into system_type_count
      from asset_type
     where book_id = '00000000-0000-7000-8000-000000000210'
       and system_code in (
           'CASH', 'BANK', 'CREDIT_CARD', 'DEBIT_CARD', 'SAVINGS',
           'INVESTMENT', 'OVERDRAFT', 'LOAN', 'INSURANCE', 'OTHER'
       );

    select count(*)
      into settlement_type_count
      from asset_type
     where book_id = '00000000-0000-7000-8000-000000000210'
       and payment_source_capable
       and system_code in ('BANK', 'SAVINGS', 'OVERDRAFT');

    select count(*)
      into credit_behavior_count
      from asset_type
     where book_id = '00000000-0000-7000-8000-000000000210'
       and system_code = 'CREDIT_CARD'
       and behavior = 'CREDIT_CARD'
       and not payment_source_capable;

    select name
      into bank_name
      from asset_type
     where book_id = '00000000-0000-7000-8000-000000000210'
       and system_code = 'BANK';

    if system_type_count <> 10
       or settlement_type_count <> 3
       or credit_behavior_count <> 1
       or bank_name <> '주거래 은행' then
        raise exception
            'unexpected default types count=%, settlement=%, credit=%, bank=%',
            system_type_count,
            settlement_type_count,
            credit_behavior_count,
            bank_name;
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
    memo,
    created_by_member_id,
    updated_by_member_id
)
values
    (
        '00000000-0000-7000-8000-000000000241',
        '00000000-0000-7000-8000-000000000210',
        '00000000-0000-7000-8000-000000000231',
        'PERSONAL',
        '00000000-0000-7000-8000-000000000221',
        '생활비 계좌',
        '2026-07-01',
        '월 고정비 출금',
        '00000000-0000-7000-8000-000000000222',
        '00000000-0000-7000-8000-000000000222'
    ),
    (
        '00000000-0000-7000-8000-000000000242',
        '00000000-0000-7000-8000-000000000210',
        (
            select id from asset_type
             where book_id = '00000000-0000-7000-8000-000000000210'
               and system_code = 'CASH'
        ),
        'JOINT',
        null,
        '공동 현금',
        '2026-07-01',
        null,
        '00000000-0000-7000-8000-000000000221',
        '00000000-0000-7000-8000-000000000221'
    ),
    (
        '00000000-0000-7000-8000-000000000243',
        '00000000-0000-7000-8000-000000000210',
        (
            select id from asset_type
             where book_id = '00000000-0000-7000-8000-000000000210'
               and system_code = 'CREDIT_CARD'
        ),
        'PERSONAL',
        '00000000-0000-7000-8000-000000000222',
        '생활비 카드',
        '2026-07-01',
        null,
        '00000000-0000-7000-8000-000000000221',
        '00000000-0000-7000-8000-000000000221'
    );

-- Joint ownership cannot carry a member marker.
do $$
begin
    begin
        insert into asset (
            id, book_id, asset_type_id, ownership_scope, owner_member_id,
            name, opened_on, created_by_member_id, updated_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000244',
            '00000000-0000-7000-8000-000000000210',
            '00000000-0000-7000-8000-000000000231',
            'JOINT',
            '00000000-0000-7000-8000-000000000221',
            '잘못된 공동 자산',
            '2026-07-01',
            '00000000-0000-7000-8000-000000000221',
            '00000000-0000-7000-8000-000000000221'
        );
        raise exception 'joint asset with owner was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

-- An owner marker must belong to the same ledger.
do $$
begin
    begin
        insert into asset (
            id, book_id, asset_type_id, ownership_scope, owner_member_id,
            name, opened_on, created_by_member_id, updated_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000245',
            '00000000-0000-7000-8000-000000000210',
            '00000000-0000-7000-8000-000000000231',
            'PERSONAL',
            '00000000-0000-7000-8000-000000000223',
            '다른 가계부 소유 자산',
            '2026-07-01',
            '00000000-0000-7000-8000-000000000221',
            '00000000-0000-7000-8000-000000000221'
        );
        raise exception 'cross-ledger owner was accepted';
    exception
        when foreign_key_violation then null;
    end;
end;
$$;

insert into ledger_transaction (
    id,
    book_id,
    transaction_type,
    occurred_on,
    amount_won,
    description,
    source_type,
    source_id,
    created_by_member_id,
    updated_by_member_id
)
values (
    '00000000-0000-7000-8000-000000000251',
    '00000000-0000-7000-8000-000000000210',
    'ADJUSTMENT',
    '2026-07-01',
    125000,
    '최초 금액',
    'OPENING_BALANCE',
    '00000000-0000-7000-8000-000000000241',
    '00000000-0000-7000-8000-000000000222',
    '00000000-0000-7000-8000-000000000222'
);

insert into transaction_posting (
    transaction_id,
    line_no,
    book_id,
    asset_id,
    delta_won
)
values (
    '00000000-0000-7000-8000-000000000251',
    1,
    '00000000-0000-7000-8000-000000000210',
    '00000000-0000-7000-8000-000000000241',
    125000
);

-- One asset has at most one OPENING_BALANCE source transaction.
do $$
begin
    begin
        insert into ledger_transaction (
            id, book_id, transaction_type, occurred_on, amount_won,
            source_type, source_id, created_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000252',
            '00000000-0000-7000-8000-000000000210',
            'ADJUSTMENT',
            '2026-07-02',
            1,
            'OPENING_BALANCE',
            '00000000-0000-7000-8000-000000000241',
            '00000000-0000-7000-8000-000000000221'
        );
        raise exception 'duplicate opening balance was accepted';
    exception
        when unique_violation then null;
    end;
end;
$$;

insert into card_setting (
    card_asset_id,
    book_id,
    statement_closing_day,
    payment_day,
    payment_month_offset,
    settlement_asset_id,
    auto_settlement_enabled
)
values (
    '00000000-0000-7000-8000-000000000243',
    '00000000-0000-7000-8000-000000000210',
    15,
    25,
    1,
    '00000000-0000-7000-8000-000000000241',
    true
);

-- Auto settlement cannot be enabled without a settlement asset.
do $$
begin
    begin
        insert into card_setting (
            card_asset_id, book_id, statement_closing_day, payment_day,
            payment_month_offset, settlement_asset_id, auto_settlement_enabled
        )
        values (
            '00000000-0000-7000-8000-000000000242',
            '00000000-0000-7000-8000-000000000210',
            15,
            25,
            1,
            null,
            true
        );
        raise exception 'auto settlement without settlement asset was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

do $$
declare
    changed bigint;
    stale_changed bigint;
    current_balance bigint;
    current_version bigint;
begin
    update asset
       set name = '생활비 계좌 수정',
           version = version + 1,
           updated_at = now()
     where id = '00000000-0000-7000-8000-000000000241'
       and version = 0;
    get diagnostics changed = row_count;

    update asset
       set memo = '뒤늦은 수정',
           version = version + 1,
           updated_at = now()
     where id = '00000000-0000-7000-8000-000000000241'
       and version = 0;
    get diagnostics stale_changed = row_count;

    select current_balance_won
      into current_balance
      from asset_current_balance
     where asset_id = '00000000-0000-7000-8000-000000000241';

    select version
      into current_version
      from asset
     where id = '00000000-0000-7000-8000-000000000241';

    if changed <> 1
       or stale_changed <> 0
       or current_balance <> 125000
       or current_version <> 1 then
        raise exception
            'unexpected asset state changed=%, stale=%, balance=%, version=%',
            changed,
            stale_changed,
            current_balance,
            current_version;
    end if;
end;
$$;

rollback;
