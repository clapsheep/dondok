-- Apply after V1 and V2, immediately before V3 and V4, in a disposable database.
insert into app_user (id, display_name, email)
values
    ('00000000-0000-7000-8000-000000000301', '거래 사용자 1', 'transaction1@example.test'),
    ('00000000-0000-7000-8000-000000000302', '거래 사용자 2', 'transaction2@example.test'),
    ('00000000-0000-7000-8000-000000000303', '다른 가계부 사용자', 'transaction3@example.test');

insert into ledger_book (id, created_by_user_id)
values
    ('00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000301'),
    ('00000000-0000-7000-8000-000000000311', '00000000-0000-7000-8000-000000000303');

insert into ledger_member (id, book_id, user_id, joined_at)
values
    ('00000000-0000-7000-8000-000000000321', '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000301', '2026-07-01T00:00:00Z'),
    ('00000000-0000-7000-8000-000000000322', '00000000-0000-7000-8000-000000000310', '00000000-0000-7000-8000-000000000302', '2026-07-02T00:00:00Z'),
    ('00000000-0000-7000-8000-000000000323', '00000000-0000-7000-8000-000000000311', '00000000-0000-7000-8000-000000000303', '2026-07-01T00:00:00Z');

-- A renamed system category is user data and must survive the backfill.
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
values (
    '00000000-0000-7000-8000-000000000331',
    '00000000-0000-7000-8000-000000000310',
    'EXPENSE',
    'FOOD',
    false,
    '외식과 식비',
    10,
    '00000000-0000-7000-8000-000000000321',
    '00000000-0000-7000-8000-000000000321'
);
