-- Apply after V1 through V5, immediately before V6, in a disposable database.
insert into app_user (id, display_name, email)
values (
    '00000000-0000-7000-8000-000000000601',
    '고정 자산 종류 사용자',
    'fixed-asset-type@example.test'
);

insert into ledger_book (id, created_by_user_id)
values (
    '00000000-0000-7000-8000-000000000610',
    '00000000-0000-7000-8000-000000000601'
);

insert into ledger_member (id, book_id, user_id)
values (
    '00000000-0000-7000-8000-000000000611',
    '00000000-0000-7000-8000-000000000610',
    '00000000-0000-7000-8000-000000000601'
);

insert into asset_type (
    id,
    book_id,
    system_code,
    name,
    behavior,
    payment_source_capable,
    is_custom,
    sort_order,
    archived_at,
    created_by_member_id
)
values
    (
        '00000000-0000-7000-8000-000000000621',
        '00000000-0000-7000-8000-000000000610',
        'OTHER',
        '기타',
        'CREDIT_CARD',
        true,
        false,
        100,
        '2026-07-01T00:00:00Z',
        '00000000-0000-7000-8000-000000000611'
    ),
    (
        '00000000-0000-7000-8000-000000000622',
        '00000000-0000-7000-8000-000000000610',
        'SAVINGS',
        '저축',
        'STANDARD',
        true,
        false,
        50,
        null,
        '00000000-0000-7000-8000-000000000611'
    ),
    (
        '00000000-0000-7000-8000-000000000623',
        '00000000-0000-7000-8000-000000000610',
        null,
        '반려동물',
        'STANDARD',
        false,
        true,
        110,
        null,
        '00000000-0000-7000-8000-000000000611'
    ),
    (
        '00000000-0000-7000-8000-000000000624',
        '00000000-0000-7000-8000-000000000610',
        null,
        '사용하지 않는 종류',
        'STANDARD',
        false,
        true,
        120,
        null,
        '00000000-0000-7000-8000-000000000611'
    );

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
values (
    '00000000-0000-7000-8000-000000000631',
    '00000000-0000-7000-8000-000000000610',
    '00000000-0000-7000-8000-000000000623',
    'PERSONAL',
    '00000000-0000-7000-8000-000000000611',
    '반려동물 통장',
    '2026-07-01',
    '이름과 메모는 보존',
    '00000000-0000-7000-8000-000000000611',
    '00000000-0000-7000-8000-000000000611'
);

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
    '00000000-0000-7000-8000-000000000641',
    '00000000-0000-7000-8000-000000000610',
    'ADJUSTMENT',
    '2026-07-01',
    12345,
    '사용자 정의 자산 최초 금액',
    'OPENING_BALANCE',
    '00000000-0000-7000-8000-000000000631',
    '00000000-0000-7000-8000-000000000611',
    '00000000-0000-7000-8000-000000000611'
);

insert into transaction_posting (
    transaction_id,
    line_no,
    book_id,
    asset_id,
    delta_won
)
values (
    '00000000-0000-7000-8000-000000000641',
    1,
    '00000000-0000-7000-8000-000000000610',
    '00000000-0000-7000-8000-000000000631',
    12345
);
