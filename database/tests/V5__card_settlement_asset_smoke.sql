\set ON_ERROR_STOP on

-- Apply after Flyway V5 in a disposable database. The transaction recreates the
-- pre-V5 state so the migration itself proves that legacy null rows survive.
begin;

alter table card_setting
    drop constraint ck_card_setting_settlement_asset_required;

insert into app_user (id, display_name, email)
values (
    '00000000-0000-7000-8000-000000000501',
    '카드 설정 사용자',
    'card-setting-v5@example.test'
);

insert into ledger_book (id, created_by_user_id)
values (
    '00000000-0000-7000-8000-000000000510',
    '00000000-0000-7000-8000-000000000501'
);

insert into ledger_member (id, book_id, user_id)
values (
    '00000000-0000-7000-8000-000000000511',
    '00000000-0000-7000-8000-000000000510',
    '00000000-0000-7000-8000-000000000501'
);

insert into asset_type (
    id,
    book_id,
    system_code,
    name,
    behavior,
    payment_source_capable,
    created_by_member_id
)
values
    (
        '00000000-0000-7000-8000-000000000521',
        '00000000-0000-7000-8000-000000000510',
        'BANK',
        '은행',
        'STANDARD',
        true,
        '00000000-0000-7000-8000-000000000511'
    ),
    (
        '00000000-0000-7000-8000-000000000522',
        '00000000-0000-7000-8000-000000000510',
        'CREDIT_CARD',
        '신용카드',
        'CREDIT_CARD',
        false,
        '00000000-0000-7000-8000-000000000511'
    );

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
        '00000000-0000-7000-8000-000000000531',
        '00000000-0000-7000-8000-000000000510',
        '00000000-0000-7000-8000-000000000521',
        'PERSONAL',
        '00000000-0000-7000-8000-000000000511',
        '결제 계좌',
        '2026-07-01',
        '00000000-0000-7000-8000-000000000511',
        '00000000-0000-7000-8000-000000000511'
    ),
    (
        '00000000-0000-7000-8000-000000000532',
        '00000000-0000-7000-8000-000000000510',
        '00000000-0000-7000-8000-000000000522',
        'PERSONAL',
        '00000000-0000-7000-8000-000000000511',
        '기존 카드',
        '2026-07-01',
        '00000000-0000-7000-8000-000000000511',
        '00000000-0000-7000-8000-000000000511'
    ),
    (
        '00000000-0000-7000-8000-000000000533',
        '00000000-0000-7000-8000-000000000510',
        '00000000-0000-7000-8000-000000000522',
        'PERSONAL',
        '00000000-0000-7000-8000-000000000511',
        '신규 카드',
        '2026-07-01',
        '00000000-0000-7000-8000-000000000511',
        '00000000-0000-7000-8000-000000000511'
    );

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
    '00000000-0000-7000-8000-000000000532',
    '00000000-0000-7000-8000-000000000510',
    15,
    25,
    1,
    null,
    false
);

\ir ../../backend/src/main/resources/db/migration/V5__require_card_settlement_asset.sql

do $$
declare
    constraint_validated boolean;
begin
    select convalidated
      into constraint_validated
      from pg_constraint
     where conrelid = 'card_setting'::regclass
       and conname = 'ck_card_setting_settlement_asset_required';

    if constraint_validated is null or constraint_validated then
        raise exception 'required NOT VALID card settlement constraint was not installed';
    end if;

    if not exists (
        select 1
          from card_setting
         where card_asset_id = '00000000-0000-7000-8000-000000000532'
           and settlement_asset_id is null
    ) then
        raise exception 'legacy null card setting did not survive the migration';
    end if;
end;
$$;

-- New card settings require a settlement asset even when auto settlement is off.
do $$
begin
    begin
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
            '00000000-0000-7000-8000-000000000533',
            '00000000-0000-7000-8000-000000000510',
            15,
            25,
            1,
            null,
            false
        );
        raise exception 'new card setting without settlement asset was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

-- An existing legacy row remains readable but cannot be modified while invalid.
do $$
begin
    begin
        update card_setting
           set payment_day = 26
         where card_asset_id = '00000000-0000-7000-8000-000000000532';
        raise exception 'legacy null card setting was modified without remediation';
    exception
        when check_violation then null;
    end;
end;
$$;

-- Supplying a settlement asset remediates the legacy row in the same update.
update card_setting
   set payment_day = 26,
       settlement_asset_id = '00000000-0000-7000-8000-000000000531'
 where card_asset_id = '00000000-0000-7000-8000-000000000532';

rollback;
