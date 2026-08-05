\set ON_ERROR_STOP on

-- Apply after V16__merge_overdraft_fixture.sql and Flyway V16 in a disposable database.
do $$
declare
    migrated_type_id uuid;
    migrated_name varchar(100);
    migrated_memo varchar(1000);
    migrated_version bigint;
    posting_total bigint;
begin
    select asset_type_id, name, memo, version
      into migrated_type_id, migrated_name, migrated_memo, migrated_version
      from asset
     where id = '00000000-0000-7000-8000-000000001631';

    select sum(delta_won)
      into posting_total
      from transaction_posting
     where asset_id = '00000000-0000-7000-8000-000000001631';

    if migrated_type_id <> '00000000-0000-7000-8000-000000001621'
       or migrated_name <> '생활비 마이너스 통장'
       or migrated_memo <> '이름과 모든 연결을 보존'
       or migrated_version <> 5
       or posting_total <> -300000
       or exists (
           select 1
             from asset_type
            where system_code = 'OVERDRAFT'
       )
       or not exists (
           select 1
             from card_setting
            where card_asset_id = '00000000-0000-7000-8000-000000001632'
              and settlement_asset_id = '00000000-0000-7000-8000-000000001631'
       )
       or not exists (
           select 1
             from debit_card_setting
            where debit_card_asset_id = '00000000-0000-7000-8000-000000001633'
              and payment_asset_id = '00000000-0000-7000-8000-000000001631'
       )
       or not exists (
           select 1
             from savings_setting
            where savings_asset_id = '00000000-0000-7000-8000-000000001634'
              and transfer_asset_id = '00000000-0000-7000-8000-000000001631'
       )
       or not exists (
           select 1
             from ledger_transaction
            where id = '00000000-0000-7000-8000-000000001641'
              and source_id = '00000000-0000-7000-8000-000000001631'
       ) then
        raise exception
            'unexpected V16 migration type=%, name=%, memo=%, version=%, posting=%',
            migrated_type_id,
            migrated_name,
            migrated_memo,
            migrated_version,
            posting_total;
    end if;
end;
$$;

begin;

-- The removed physical type cannot be reintroduced after the migration.
do $$
begin
    begin
        insert into asset_type (
            id,
            book_id,
            system_code,
            name,
            behavior,
            payment_source_capable,
            sort_order,
            created_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000001626',
            '00000000-0000-7000-8000-000000001610',
            'OVERDRAFT',
            '다시 만든 마이너스 통장',
            'STANDARD',
            true,
            70,
            '00000000-0000-7000-8000-000000001611'
        );
        raise exception 'OVERDRAFT asset type was accepted after V16';
    exception
        when check_violation then null;
    end;
end;
$$;

rollback;
