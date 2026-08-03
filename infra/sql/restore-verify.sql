\set ON_ERROR_STOP on

create temporary table restore_expectation (expected_flyway_version varchar(50) not null);
insert into restore_expectation values (:'expected_flyway_version');

do $$
declare
    required_relation text;
    latest_flyway_version text;
    cascade_tables text[];
    expected_cascade_tables constant text[] := array[
        'api_idempotency',
        'asset',
        'asset_type',
        'audit_log',
        'card_charge',
        'card_payment_schedule',
        'card_purchase_billing_snapshot',
        'card_purchase_refund',
        'card_purchase_refund_charge',
        'card_purchase_refund_payment',
        'card_setting',
        'card_statement',
        'card_statement_payment',
        'category',
        'debit_card_setting',
        'ledger_invitation',
        'ledger_invitation_redemption',
        'ledger_member',
        'ledger_transaction',
        'savings_setting',
        'transaction_posting'
    ];
begin
    if current_setting('server_encoding') <> 'UTF8' then
        raise exception 'restore database encoding must be UTF8';
    end if;

    foreach required_relation in array array[
        'flyway_schema_history',
        'app_user',
        'local_credential',
        'spring_session',
        'spring_session_attributes',
        'ledger_book',
        'ledger_member',
        'asset',
        'asset_type',
        'category',
        'ledger_transaction',
        'transaction_posting',
        'card_statement',
        'card_statement_payment',
        'card_purchase_refund'
    ] loop
        if to_regclass('public.' || required_relation) is null then
            raise exception 'required restored relation is missing: %', required_relation;
        end if;
    end loop;

    foreach required_relation in array array[
        'asset_current_balance',
        'card_statement_forecast',
        'ledger_financial_activity'
    ] loop
        if to_regclass('public.' || required_relation) is null then
            raise exception 'required restored view is missing: %', required_relation;
        end if;
    end loop;

    if exists (select 1 from flyway_schema_history where not success) then
        raise exception 'restored Flyway history contains a failed migration';
    end if;

    select version
      into latest_flyway_version
      from flyway_schema_history
     where success
     order by installed_rank desc
     limit 1;

    if latest_flyway_version is distinct from
       (select expected_flyway_version from restore_expectation) then
        raise exception 'restored Flyway version % does not match expected %',
            latest_flyway_version,
            (select expected_flyway_version from restore_expectation);
    end if;

    if not exists (
        select 1
          from pg_constraint constraint_row
         where constraint_row.conrelid = 'card_setting'::regclass
           and constraint_row.conname = 'ck_card_setting_settlement_asset_required'
           and constraint_row.contype = 'c'
           and not constraint_row.convalidated
           and pg_get_constraintdef(constraint_row.oid, true) =
               'CHECK (settlement_asset_id IS NOT NULL) NOT VALID'
    ) then
        raise exception 'expected V5 legacy card settlement constraint is missing or differs';
    end if;

    if exists (
        select 1
          from pg_constraint constraint_row
          join pg_namespace namespace_row
            on namespace_row.oid = constraint_row.connamespace
         where namespace_row.nspname = 'public'
           and not constraint_row.convalidated
           and not (
               constraint_row.conrelid = 'card_setting'::regclass
               and constraint_row.conname = 'ck_card_setting_settlement_asset_required'
               and constraint_row.contype = 'c'
           )
    ) then
        raise exception 'restored schema contains an unexpected unvalidated constraint';
    end if;

    if not exists (
        select 1
          from pg_class index_row
          join pg_index index_state on index_state.indexrelid = index_row.oid
         where index_row.oid = to_regclass('public.ix_ledger_transaction_primary_asset_history')
           and index_state.indisvalid
           and index_state.indisready
    ) then
        raise exception 'required transaction history index is missing or invalid';
    end if;

    select array_agg(child.relname order by child.relname)
      into cascade_tables
      from pg_constraint constraint_row
      join pg_class child on child.oid = constraint_row.conrelid
     where constraint_row.contype = 'f'
       and constraint_row.confrelid = 'ledger_book'::regclass
       and constraint_row.confdeltype = 'c';

    if cascade_tables is distinct from expected_cascade_tables then
        raise exception 'ledger cascade FK set differs from the expected 21 tables';
    end if;

    if exists (
        select 1 from ledger_member member_row
        left join ledger_book book on book.id = member_row.book_id
        where book.id is null
    ) or exists (
        select 1 from asset asset_row
        left join ledger_book book on book.id = asset_row.book_id
        left join asset_type type_row
          on type_row.book_id = asset_row.book_id and type_row.id = asset_row.asset_type_id
        where book.id is null or type_row.id is null
    ) or exists (
        select 1 from ledger_transaction transaction_row
        left join ledger_book book on book.id = transaction_row.book_id
        where book.id is null
    ) or exists (
        select 1 from transaction_posting posting
        left join ledger_transaction transaction_row
          on transaction_row.book_id = posting.book_id and transaction_row.id = posting.transaction_id
        left join asset asset_row
          on asset_row.book_id = posting.book_id and asset_row.id = posting.asset_id
        where transaction_row.id is null or asset_row.id is null
    ) then
        raise exception 'restored data contains a representative orphan row';
    end if;
end
$$;

select * from asset_current_balance limit 0;
select * from card_statement_forecast limit 0;
select * from ledger_financial_activity limit 0;

select 'restore verification passed' as result,
       (select expected_flyway_version from restore_expectation) as flyway_version;
