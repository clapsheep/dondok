-- Apply after V1 and V2, immediately before V3, in a disposable database.
insert into app_user (id, display_name, email)
values
    ('00000000-0000-7000-8000-000000000201', '자산 사용자 1', 'asset1@example.test'),
    ('00000000-0000-7000-8000-000000000202', '자산 사용자 2', 'asset2@example.test'),
    ('00000000-0000-7000-8000-000000000203', '다른 가계부 사용자', 'asset3@example.test');

insert into ledger_book (id, created_by_user_id)
values
    ('00000000-0000-7000-8000-000000000210', '00000000-0000-7000-8000-000000000201'),
    ('00000000-0000-7000-8000-000000000211', '00000000-0000-7000-8000-000000000203');

insert into ledger_member (id, book_id, user_id, joined_at)
values
    ('00000000-0000-7000-8000-000000000221', '00000000-0000-7000-8000-000000000210', '00000000-0000-7000-8000-000000000201', '2026-07-01T00:00:00Z'),
    ('00000000-0000-7000-8000-000000000222', '00000000-0000-7000-8000-000000000210', '00000000-0000-7000-8000-000000000202', '2026-07-02T00:00:00Z'),
    ('00000000-0000-7000-8000-000000000223', '00000000-0000-7000-8000-000000000211', '00000000-0000-7000-8000-000000000203', '2026-07-01T00:00:00Z');

-- A renamed system type from before this migration is preserved and not duplicated.
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
values (
    '00000000-0000-7000-8000-000000000231',
    '00000000-0000-7000-8000-000000000210',
    'BANK',
    '주거래 은행',
    'STANDARD',
    true,
    false,
    20,
    '00000000-0000-7000-8000-000000000221'
);
