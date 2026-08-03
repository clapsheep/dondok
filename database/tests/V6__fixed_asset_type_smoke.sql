\set ON_ERROR_STOP on

-- Apply after V6__fixed_asset_type_fixture.sql and V6 in a disposable database.
do $$
declare
    system_code_nullable varchar(3);
    migrated_type_id uuid;
    migrated_name varchar(100);
    migrated_memo varchar(1000);
    migrated_version bigint;
    savings_name varchar(100);
    other_behavior varchar(20);
    other_payment_source boolean;
    other_archived_at timestamptz;
    posting_total bigint;
begin
    select is_nullable
      into system_code_nullable
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'asset_type'
       and column_name = 'system_code';

    if system_code_nullable <> 'NO'
       or exists (
           select 1
             from information_schema.columns
            where table_schema = 'public'
              and table_name = 'asset_type'
              and column_name in ('is_custom', 'name_normalized')
       )
       or exists (
           select 1
             from pg_indexes
            where schemaname = 'public'
              and tablename = 'asset_type'
              and indexname = 'uq_asset_type_active_name'
       ) then
        raise exception 'asset_type legacy columns or active-name index remain';
    end if;

    select asset_type_id, name, memo, version
      into migrated_type_id, migrated_name, migrated_memo, migrated_version
      from asset
     where id = '00000000-0000-7000-8000-000000000631';

    select name
      into savings_name
      from asset_type
     where book_id = '00000000-0000-7000-8000-000000000610'
       and system_code = 'SAVINGS';

    select behavior, payment_source_capable, archived_at
      into other_behavior, other_payment_source, other_archived_at
      from asset_type
     where id = '00000000-0000-7000-8000-000000000621';

    select sum(delta_won)
      into posting_total
      from transaction_posting
     where asset_id = '00000000-0000-7000-8000-000000000631';

    if migrated_type_id <> '00000000-0000-7000-8000-000000000621'
       or migrated_name <> '반려동물 통장'
       or migrated_memo <> '이름과 메모는 보존'
       or migrated_version <> 1
       or savings_name <> '적금'
       or other_behavior <> 'STANDARD'
       or other_payment_source
       or other_archived_at is not null
       or posting_total <> 12345
       or not exists (
           select 1
             from ledger_transaction
            where id = '00000000-0000-7000-8000-000000000641'
              and source_id = '00000000-0000-7000-8000-000000000631'
       )
       or exists (
           select 1
             from asset_type
            where id in (
                '00000000-0000-7000-8000-000000000623',
                '00000000-0000-7000-8000-000000000624'
            )
       ) then
        raise exception
            'unexpected V6 migration type=%, name=%, memo=%, version=%, savings=%, other=(%, %, %), posting=%',
            migrated_type_id,
            migrated_name,
            migrated_memo,
            migrated_version,
            savings_name,
            other_behavior,
            other_payment_source,
            other_archived_at,
            posting_total;
    end if;
end;
$$;

begin;

-- New ad-hoc types cannot be inserted without a fixed system code.
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
            created_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000625',
            '00000000-0000-7000-8000-000000000610',
            null,
            '임의 종류',
            'STANDARD',
            false,
            '00000000-0000-7000-8000-000000000611'
        );
        raise exception 'asset type without system code was accepted';
    exception
        when not_null_violation then null;
    end;
end;
$$;

-- A syntactically valid but unsupported code cannot extend the fixed taxonomy.
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
            created_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000627',
            '00000000-0000-7000-8000-000000000610',
            'FOO',
            '허용되지 않은 종류',
            'STANDARD',
            false,
            '00000000-0000-7000-8000-000000000611'
        );
        raise exception 'unsupported fixed asset type code was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

-- OTHER remains a standard, non-payment-source, active type.
do $$
begin
    begin
        update asset_type
           set behavior = 'CREDIT_CARD'
         where id = '00000000-0000-7000-8000-000000000621';
        raise exception 'OTHER behavior was changed';
    exception
        when check_violation then null;
    end;

    begin
        update asset_type
           set payment_source_capable = true
         where id = '00000000-0000-7000-8000-000000000621';
        raise exception 'OTHER payment-source capability was changed';
    exception
        when check_violation then null;
    end;

    begin
        update asset_type
           set archived_at = now()
         where id = '00000000-0000-7000-8000-000000000621';
        raise exception 'OTHER was archived';
    exception
        when check_violation then null;
    end;
end;
$$;

-- The existing per-ledger system-code unique index remains the identity guard.
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
            created_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000626',
            '00000000-0000-7000-8000-000000000610',
            'OTHER',
            '중복 기타',
            'STANDARD',
            false,
            '00000000-0000-7000-8000-000000000611'
        );
        raise exception 'duplicate system asset type was accepted';
    exception
        when unique_violation then null;
    end;
end;
$$;

rollback;
