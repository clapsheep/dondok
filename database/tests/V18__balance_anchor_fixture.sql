\set ON_ERROR_STOP on

-- Apply after Flyway V1 through V17, immediately before V18, in a disposable database.
insert into app_user (id, display_name, email, status, email_verified_at)
values (
    '00000000-0000-7000-8000-000000001801',
    '기준 잔액 마이그레이션 사용자',
    'balance-anchor-migration@example.test',
    'ACTIVE',
    now()
);

insert into ledger_book (id, created_by_user_id)
values (
    '00000000-0000-7000-8000-000000001810',
    '00000000-0000-7000-8000-000000001801'
);

insert into ledger_member (id, book_id, user_id)
values (
    '00000000-0000-7000-8000-000000001811',
    '00000000-0000-7000-8000-000000001810',
    '00000000-0000-7000-8000-000000001801'
);

insert into asset_type (
    id, book_id, system_code, name, behavior,
    payment_source_capable, sort_order, created_by_member_id
)
values (
    '00000000-0000-7000-8000-000000001821',
    '00000000-0000-7000-8000-000000001810',
    'BANK',
    '계좌',
    'STANDARD',
    true,
    20,
    '00000000-0000-7000-8000-000000001811'
);

insert into asset (
    id, book_id, asset_type_id, ownership_scope, owner_member_id,
    name, opened_on, created_by_member_id, updated_by_member_id
)
values (
    '00000000-0000-7000-8000-000000001831',
    '00000000-0000-7000-8000-000000001810',
    '00000000-0000-7000-8000-000000001821',
    'PERSONAL',
    '00000000-0000-7000-8000-000000001811',
    '기준 잔액 계좌',
    '2026-08-03',
    '00000000-0000-7000-8000-000000001811',
    '00000000-0000-7000-8000-000000001811'
);

insert into ledger_transaction (
    id, book_id, transaction_type, transfer_subtype, occurred_on,
    amount_won, description, source_type, source_id,
    performed_by_member_id, created_by_member_id, updated_by_member_id
)
values
    (
        '00000000-0000-7000-8000-000000001841',
        '00000000-0000-7000-8000-000000001810',
        'ADJUSTMENT', null, '2026-08-03', 100000,
        '기존 최초 잔액', 'OPENING_BALANCE',
        '00000000-0000-7000-8000-000000001831', null,
        '00000000-0000-7000-8000-000000001811',
        '00000000-0000-7000-8000-000000001811'
    ),
    (
        '00000000-0000-7000-8000-000000001842',
        '00000000-0000-7000-8000-000000001810',
        'TRANSFER', 'NORMAL', '2026-08-02', 20000,
        '기준일 전 지출 효과', 'MANUAL', null,
        '00000000-0000-7000-8000-000000001811',
        '00000000-0000-7000-8000-000000001811',
        '00000000-0000-7000-8000-000000001811'
    ),
    (
        '00000000-0000-7000-8000-000000001843',
        '00000000-0000-7000-8000-000000001810',
        'TRANSFER', 'NORMAL', '2026-08-03', 5000,
        '기준일 수입 효과', 'MANUAL', null,
        '00000000-0000-7000-8000-000000001811',
        '00000000-0000-7000-8000-000000001811',
        '00000000-0000-7000-8000-000000001811'
    );

insert into transaction_posting (
    transaction_id, line_no, book_id, asset_id, delta_won
)
values
    (
        '00000000-0000-7000-8000-000000001841', 1,
        '00000000-0000-7000-8000-000000001810',
        '00000000-0000-7000-8000-000000001831', 100000
    ),
    (
        '00000000-0000-7000-8000-000000001842', 1,
        '00000000-0000-7000-8000-000000001810',
        '00000000-0000-7000-8000-000000001831', -20000
    ),
    (
        '00000000-0000-7000-8000-000000001843', 1,
        '00000000-0000-7000-8000-000000001810',
        '00000000-0000-7000-8000-000000001831', 5000
    );

do $$
begin
    if (select current_balance_won
          from asset_current_balance
         where asset_id = '00000000-0000-7000-8000-000000001831') <> 85000 then
        raise exception 'pre-V18 fixture balance must be 85000';
    end if;
end;
$$;
