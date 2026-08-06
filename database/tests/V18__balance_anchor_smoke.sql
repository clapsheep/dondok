\set ON_ERROR_STOP on

-- Apply after V18__balance_anchor_fixture.sql and Flyway V18 in a disposable database.
do $$
declare
    anchor_won bigint;
    current_won bigint;
begin
    select asset.balance_anchor_won, balance.current_balance_won
      into anchor_won, current_won
      from asset
      join asset_current_balance balance
        on balance.book_id = asset.book_id
       and balance.asset_id = asset.id
     where asset.id = '00000000-0000-7000-8000-000000001831';

    if anchor_won <> 80000 or current_won <> 85000 then
        raise exception 'unexpected V18 anchor/current: anchor=%, current=%',
            anchor_won, current_won;
    end if;
end;
$$;

begin;

insert into ledger_transaction (
    id, book_id, transaction_type, transfer_subtype, occurred_on,
    amount_won, description, source_type, performed_by_member_id,
    created_by_member_id, updated_by_member_id
)
values (
    '00000000-0000-7000-8000-000000001844',
    '00000000-0000-7000-8000-000000001810',
    'TRANSFER', 'NORMAL', '2026-08-01', 10000,
    '마이그레이션 뒤 추가한 기준일 전 기록', 'MANUAL',
    '00000000-0000-7000-8000-000000001811',
    '00000000-0000-7000-8000-000000001811',
    '00000000-0000-7000-8000-000000001811'
);

insert into transaction_posting (
    transaction_id, line_no, book_id, asset_id, delta_won
)
values (
    '00000000-0000-7000-8000-000000001844', 1,
    '00000000-0000-7000-8000-000000001810',
    '00000000-0000-7000-8000-000000001831', -10000
);

do $$
begin
    if (select current_balance_won
          from asset_current_balance
         where asset_id = '00000000-0000-7000-8000-000000001831') <> 85000 then
        raise exception 'a transaction before the anchor changed the current balance';
    end if;
end;
$$;

rollback;
