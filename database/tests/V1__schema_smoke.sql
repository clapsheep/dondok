begin;

insert into app_user (id, display_name, email)
values
    ('00000000-0000-7000-8000-000000000001', '사용자 1', 'member1@example.test'),
    ('00000000-0000-7000-8000-000000000002', '사용자 2', 'member2@example.test'),
    ('00000000-0000-7000-8000-000000000003', '사용자 3', 'member3@example.test'),
    ('00000000-0000-7000-8000-000000000004', '사용자 4', 'member4@example.test');

-- Email uniqueness is case-insensitive for password recovery identity.
do $$
begin
    begin
        insert into app_user (id, display_name, email)
        values (
            '00000000-0000-7000-8000-000000000005',
            '중복 이메일',
            'MEMBER1@example.test'
        );
        raise exception 'case-insensitive duplicate email was accepted';
    exception
        when unique_violation then null;
    end;
end;
$$;

-- A ledger is identified by membership and does not have a user-defined name.
insert into ledger_book (id, created_by_user_id)
values
    (
        '00000000-0000-7000-8000-000000000010',
        '00000000-0000-7000-8000-000000000001'
    ),
    (
        '00000000-0000-7000-8000-000000000014',
        '00000000-0000-7000-8000-000000000004'
    );

do $$
begin
    if exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'ledger_book'
           and column_name = 'name'
    ) then
        raise exception 'ledger_book.name still exists';
    end if;
end;
$$;

insert into ledger_member (id, book_id, user_id)
values
    (
        '00000000-0000-7000-8000-000000000011',
        '00000000-0000-7000-8000-000000000010',
        '00000000-0000-7000-8000-000000000001'
    ),
    (
        '00000000-0000-7000-8000-000000000012',
        '00000000-0000-7000-8000-000000000010',
        '00000000-0000-7000-8000-000000000002'
    ),
    (
        '00000000-0000-7000-8000-000000000015',
        '00000000-0000-7000-8000-000000000014',
        '00000000-0000-7000-8000-000000000004'
    );

insert into ledger_invitation (
    id,
    book_id,
    inviter_member_id,
    link_token_digest,
    direct_code_digest
)
values (
    '00000000-0000-7000-8000-000000000020',
    '00000000-0000-7000-8000-000000000010',
    '00000000-0000-7000-8000-000000000011',
    repeat('a', 64),
    repeat('c', 64)
);

insert into ledger_member (id, book_id, user_id)
values (
    '00000000-0000-7000-8000-000000000013',
    '00000000-0000-7000-8000-000000000010',
    '00000000-0000-7000-8000-000000000003'
);

insert into ledger_invitation_redemption (
    book_id,
    invitation_id,
    user_id,
    member_id
)
values (
    '00000000-0000-7000-8000-000000000010',
    '00000000-0000-7000-8000-000000000020',
    '00000000-0000-7000-8000-000000000003',
    '00000000-0000-7000-8000-000000000013'
);

update ledger_invitation
   set status = 'REDEEMED',
       redeemed_at = now(),
       version = version + 1,
       updated_at = now()
 where id = '00000000-0000-7000-8000-000000000020';

-- A user cannot join two ledgers at the same time.
do $$
begin
    begin
        insert into ledger_member (id, book_id, user_id)
        values (
            '00000000-0000-7000-8000-000000000016',
            '00000000-0000-7000-8000-000000000014',
            '00000000-0000-7000-8000-000000000001'
        );
        raise exception 'duplicate user membership was accepted';
    exception
        when unique_violation then null;
    end;
end;
$$;

-- A one-time invitation can have only one redemption row.
do $$
begin
    begin
        insert into ledger_invitation_redemption (
            book_id,
            invitation_id,
            user_id,
            member_id
        )
        values (
            '00000000-0000-7000-8000-000000000010',
            '00000000-0000-7000-8000-000000000020',
            '00000000-0000-7000-8000-000000000004',
            '00000000-0000-7000-8000-000000000015'
        );
        raise exception 'one-time invitation was redeemed twice';
    exception
        when unique_violation then null;
    end;
end;
$$;

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
        '00000000-0000-7000-8000-000000000031',
        '00000000-0000-7000-8000-000000000010',
        'BANK',
        '은행',
        'STANDARD',
        true,
        '00000000-0000-7000-8000-000000000011'
    ),
    (
        '00000000-0000-7000-8000-000000000032',
        '00000000-0000-7000-8000-000000000010',
        'CREDIT_CARD',
        '신용카드',
        'CREDIT_CARD',
        false,
        '00000000-0000-7000-8000-000000000011'
    ),
    (
        '00000000-0000-7000-8000-000000000033',
        '00000000-0000-7000-8000-000000000010',
        'CASH',
        '현금',
        'STANDARD',
        false,
        '00000000-0000-7000-8000-000000000011'
    );

insert into asset (
    id,
    book_id,
    asset_type_id,
    ownership_scope,
    owner_member_id,
    name,
    opened_on,
    balance_anchor_won,
    created_by_member_id,
    updated_by_member_id
)
values
    (
        '00000000-0000-7000-8000-000000000041',
        '00000000-0000-7000-8000-000000000010',
        '00000000-0000-7000-8000-000000000031',
        'PERSONAL',
        '00000000-0000-7000-8000-000000000011',
        '사용자 1 생활비 계좌',
        '2026-01-01',
        0,
        '00000000-0000-7000-8000-000000000011',
        '00000000-0000-7000-8000-000000000011'
    ),
    (
        '00000000-0000-7000-8000-000000000042',
        '00000000-0000-7000-8000-000000000010',
        '00000000-0000-7000-8000-000000000032',
        'PERSONAL',
        '00000000-0000-7000-8000-000000000012',
        '사용자 2 카드',
        '2026-07-20',
        -30000,
        '00000000-0000-7000-8000-000000000012',
        '00000000-0000-7000-8000-000000000012'
    ),
    (
        '00000000-0000-7000-8000-000000000043',
        '00000000-0000-7000-8000-000000000010',
        '00000000-0000-7000-8000-000000000033',
        'JOINT',
        null,
        '공동 현금',
        '2026-01-01',
        50000,
        '00000000-0000-7000-8000-000000000011',
        '00000000-0000-7000-8000-000000000011'
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
    '00000000-0000-7000-8000-000000000042',
    '00000000-0000-7000-8000-000000000010',
    15,
    25,
    1,
    '00000000-0000-7000-8000-000000000041',
    true
);

insert into korean_public_holiday (holiday_on, name)
values ('2026-08-17', '대체공휴일');

insert into category (
    id,
    book_id,
    kind,
    system_code,
    is_fallback,
    name,
    created_by_member_id,
    updated_by_member_id
)
values
    ('00000000-0000-7000-8000-000000000051', '00000000-0000-7000-8000-000000000010', 'INCOME', 'OTHER', true, '기타 수입', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000052', '00000000-0000-7000-8000-000000000010', 'EXPENSE', 'OTHER', true, '기타 지출', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000053', '00000000-0000-7000-8000-000000000010', 'INCOME', 'SALARY', false, '급여', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000054', '00000000-0000-7000-8000-000000000010', 'EXPENSE', 'FOOD', false, '식비', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000055', '00000000-0000-7000-8000-000000000010', 'EXPENSE', null, false, '반려동물', '00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000012');

insert into ledger_transaction (
    id,
    book_id,
    transaction_type,
    transfer_subtype,
    occurred_on,
    amount_won,
    category_id,
    primary_asset_id,
    performed_by_member_id,
    description,
    source_type,
    source_id,
    created_by_member_id,
    updated_by_member_id
)
values
    ('00000000-0000-7000-8000-000000000059', '00000000-0000-7000-8000-000000000010', 'ADJUSTMENT', null, '2026-07-20', 30000, null, null, null, '카드 최초 부채', 'OPENING_BALANCE', '00000000-0000-7000-8000-000000000042', '00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000012'),
    ('00000000-0000-7000-8000-000000000060', '00000000-0000-7000-8000-000000000010', 'ADJUSTMENT', null, '2026-01-01', 50000, null, null, null, '공동 현금 최초 금액', 'OPENING_BALANCE', '00000000-0000-7000-8000-000000000043', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000061', '00000000-0000-7000-8000-000000000010', 'INCOME', null, '2026-07-01', 100000, '00000000-0000-7000-8000-000000000053', '00000000-0000-7000-8000-000000000041', '00000000-0000-7000-8000-000000000011', '급여 입금', 'MANUAL', null, '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000062', '00000000-0000-7000-8000-000000000010', 'EXPENSE', null, '2026-07-02', 200000, '00000000-0000-7000-8000-000000000054', '00000000-0000-7000-8000-000000000042', '00000000-0000-7000-8000-000000000013', '사용자 2 카드로 사용자 3의 식비', 'MANUAL', null, '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000063', '00000000-0000-7000-8000-000000000010', 'TRANSFER', 'NORMAL', '2026-07-03', 100000, null, null, '00000000-0000-7000-8000-000000000011', '공동 현금으로 이동', 'MANUAL', null, '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000064', '00000000-0000-7000-8000-000000000010', 'EXPENSE', null, '2026-07-04', 30000, '00000000-0000-7000-8000-000000000055', '00000000-0000-7000-8000-000000000043', '00000000-0000-7000-8000-000000000012', '반려동물 용품', 'MANUAL', null, '00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000012');

insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
values
    ('00000000-0000-7000-8000-000000000059', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', -30000),
    ('00000000-0000-7000-8000-000000000060', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000043', 50000),
    ('00000000-0000-7000-8000-000000000061', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000041', 100000),
    ('00000000-0000-7000-8000-000000000062', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', -200000),
    ('00000000-0000-7000-8000-000000000063', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000041', -100000),
    ('00000000-0000-7000-8000-000000000063', 2, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000043', 100000),
    ('00000000-0000-7000-8000-000000000064', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000043', -30000);

-- Opening balance adjustments must not have an economic performer.
do $$
begin
    begin
        insert into ledger_transaction (
            id,
            book_id,
            transaction_type,
            occurred_on,
            amount_won,
            performed_by_member_id,
            source_type,
            source_id,
            created_by_member_id
        )
        values (
            '00000000-0000-7000-8000-000000000065',
            '00000000-0000-7000-8000-000000000010',
            'ADJUSTMENT',
            '2026-01-01',
            1,
            '00000000-0000-7000-8000-000000000011',
            'OPENING_BALANCE',
            '00000000-0000-7000-8000-000000000041',
            '00000000-0000-7000-8000-000000000011'
        );
        raise exception 'opening balance performer was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

insert into card_statement (
    id,
    book_id,
    card_asset_id,
    cycle_start,
    cycle_end,
    due_on,
    status,
    billed_amount_won,
    finalized_at,
    settled_at
)
values
    ('00000000-0000-7000-8000-000000000070', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', '2026-06-16', '2026-07-15', '2026-08-25', 'PAID', 100000, now(), now()),
    ('00000000-0000-7000-8000-000000000073', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', '2026-07-16', '2026-08-15', '2026-09-25', 'OPEN', 0, null, null);

insert into card_charge (
    id,
    book_id,
    source_transaction_id,
    card_asset_id,
    statement_id,
    charge_origin,
    installment_no,
    installment_count,
    principal_amount_won,
    expected_settlement_on
)
values
    ('00000000-0000-7000-8000-000000000074', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000062', '00000000-0000-7000-8000-000000000042', '00000000-0000-7000-8000-000000000070', 'PURCHASE', 1, 2, 100000, '2026-08-25'),
    ('00000000-0000-7000-8000-000000000075', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000062', '00000000-0000-7000-8000-000000000042', '00000000-0000-7000-8000-000000000073', 'PURCHASE', 2, 2, 100000, '2026-09-25'),
    ('00000000-0000-7000-8000-000000000079', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000059', '00000000-0000-7000-8000-000000000042', '00000000-0000-7000-8000-000000000073', 'OPENING_BALANCE', 1, 1, 30000, '2026-09-25');

-- The same installment number cannot be assigned twice.
do $$
begin
    begin
        insert into card_charge (
            id,
            book_id,
            source_transaction_id,
            card_asset_id,
            statement_id,
            installment_no,
            installment_count,
            principal_amount_won,
            expected_settlement_on
        )
        values (
            '00000000-0000-7000-8000-000000000076',
            '00000000-0000-7000-8000-000000000010',
            '00000000-0000-7000-8000-000000000062',
            '00000000-0000-7000-8000-000000000042',
            '00000000-0000-7000-8000-000000000073',
            2,
            2,
            100000,
            '2026-09-25'
        );
        raise exception 'duplicate installment was accepted';
    exception
        when unique_violation then null;
    end;
end;
$$;

insert into ledger_transaction (
    id,
    book_id,
    transaction_type,
    transfer_subtype,
    occurred_on,
    amount_won,
    category_id,
    performed_by_member_id,
    description,
    source_type,
    source_id,
    created_by_member_id,
    updated_by_member_id
)
values
    ('00000000-0000-7000-8000-000000000071', '00000000-0000-7000-8000-000000000010', 'TRANSFER', 'CARD_SETTLEMENT', '2026-08-25', 60000, null, null, '카드대금 정규 결제', 'CARD_AUTOPAY', '00000000-0000-7000-8000-000000000070', null, null),
    ('00000000-0000-7000-8000-000000000076', '00000000-0000-7000-8000-000000000010', 'TRANSFER', 'CARD_PREPAYMENT', '2026-08-01', 15000, null, null, '카드대금 1차 선결제', 'CARD_PREPAYMENT', '00000000-0000-7000-8000-000000000080', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000077', '00000000-0000-7000-8000-000000000010', 'TRANSFER', 'CARD_PREPAYMENT', '2026-08-10', 25000, null, null, '카드대금 2차 선결제', 'CARD_PREPAYMENT', '00000000-0000-7000-8000-000000000081', '00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000011');

-- Card settlement is an asset movement and cannot have an economic performer.
do $$
begin
    begin
        insert into ledger_transaction (
            id,
            book_id,
            transaction_type,
            transfer_subtype,
            occurred_on,
            amount_won,
            performed_by_member_id,
            source_type,
            source_id
        )
        values (
            '00000000-0000-7000-8000-000000000078',
            '00000000-0000-7000-8000-000000000010',
            'TRANSFER',
            'CARD_SETTLEMENT',
            '2026-08-25',
            1,
            '00000000-0000-7000-8000-000000000012',
            'CARD_AUTOPAY',
            '00000000-0000-7000-8000-000000000083'
        );
        raise exception 'card settlement performer was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;

insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
values
    ('00000000-0000-7000-8000-000000000071', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000041', -60000),
    ('00000000-0000-7000-8000-000000000071', 2, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', 60000),
    ('00000000-0000-7000-8000-000000000076', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000041', -15000),
    ('00000000-0000-7000-8000-000000000076', 2, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', 15000),
    ('00000000-0000-7000-8000-000000000077', 1, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000041', -25000),
    ('00000000-0000-7000-8000-000000000077', 2, '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000042', 25000);

insert into card_payment_schedule (
    id,
    book_id,
    statement_id,
    settlement_asset_id,
    scheduled_on,
    status,
    attempt_count
)
values (
    '00000000-0000-7000-8000-000000000072',
    '00000000-0000-7000-8000-000000000010',
    '00000000-0000-7000-8000-000000000070',
    '00000000-0000-7000-8000-000000000041',
    '2026-08-25',
    'COMPLETED',
    1
);

insert into card_statement_payment (
    id,
    book_id,
    statement_id,
    payment_type,
    settlement_asset_id,
    amount_won,
    paid_on,
    settlement_transaction_id,
    created_by_member_id
)
values
    ('00000000-0000-7000-8000-000000000080', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000070', 'PREPAYMENT', '00000000-0000-7000-8000-000000000041', 15000, '2026-08-01', '00000000-0000-7000-8000-000000000076', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000081', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000070', 'PREPAYMENT', '00000000-0000-7000-8000-000000000041', 25000, '2026-08-10', '00000000-0000-7000-8000-000000000077', '00000000-0000-7000-8000-000000000011'),
    ('00000000-0000-7000-8000-000000000082', '00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-000000000070', 'REGULAR', '00000000-0000-7000-8000-000000000041', 60000, '2026-08-25', '00000000-0000-7000-8000-000000000071', null);

-- Category deletion is one application transaction: remap, archive and audit.
update ledger_transaction
   set category_id = '00000000-0000-7000-8000-000000000052',
       updated_by_member_id = '00000000-0000-7000-8000-000000000012',
       updated_at = now(),
       version = version + 1
 where book_id = '00000000-0000-7000-8000-000000000010'
   and category_id = '00000000-0000-7000-8000-000000000055';

update category
   set archived_at = now(),
       updated_by_member_id = '00000000-0000-7000-8000-000000000012',
       updated_at = now(),
       version = version + 1
 where id = '00000000-0000-7000-8000-000000000055';

do $$
declare
    bank_balance bigint;
    card_balance bigint;
    joint_cash_balance bigint;
    expense_total numeric;
    transfer_total numeric;
    fallback_count bigint;
    member_count bigint;
    first_statement_remaining numeric;
    second_statement_remaining numeric;
    payment_count bigint;
    holiday_count bigint;
begin
    select current_balance_won into bank_balance
      from asset_current_balance
     where asset_id = '00000000-0000-7000-8000-000000000041';

    select current_balance_won into card_balance
      from asset_current_balance
     where asset_id = '00000000-0000-7000-8000-000000000042';

    select current_balance_won into joint_cash_balance
      from asset_current_balance
     where asset_id = '00000000-0000-7000-8000-000000000043';

    select sum(amount_won) into expense_total
      from ledger_transaction
     where book_id = '00000000-0000-7000-8000-000000000010'
       and transaction_type = 'EXPENSE'
       and deleted_at is null;

    select sum(amount_won) into transfer_total
      from ledger_transaction
     where book_id = '00000000-0000-7000-8000-000000000010'
       and transaction_type = 'TRANSFER'
       and deleted_at is null;

    select count(*) into fallback_count
      from ledger_transaction
     where category_id = '00000000-0000-7000-8000-000000000052';

    select count(*) into member_count
      from ledger_member
     where book_id = '00000000-0000-7000-8000-000000000010';

    select payment_amount_won into first_statement_remaining
      from card_statement_forecast
     where statement_id = '00000000-0000-7000-8000-000000000070';

    select payment_amount_won into second_statement_remaining
      from card_statement_forecast
     where statement_id = '00000000-0000-7000-8000-000000000073';

    select count(*) into payment_count
      from card_statement_payment
     where statement_id = '00000000-0000-7000-8000-000000000070';

    select count(*) into holiday_count
      from korean_public_holiday
     where holiday_on = '2026-08-17';

    if bank_balance <> -100000
       or card_balance <> 70000
       or joint_cash_balance <> 120000
       or expense_total <> 230000
       or transfer_total <> 200000
       or fallback_count <> 1
       or member_count <> 3
       or first_statement_remaining <> 0
       or second_statement_remaining <> 130000
       or payment_count <> 3
       or holiday_count <> 1 then
        raise exception
            'unexpected state bank=%, card=%, cash=%, expense=%, transfer=%, fallback=%, members=%, first_due=%, second_due=%, payments=%, holidays=%',
            bank_balance,
            card_balance,
            joint_cash_balance,
            expense_total,
            transfer_total,
            fallback_count,
            member_count,
            first_statement_remaining,
            second_statement_remaining,
            payment_count,
            holiday_count;
    end if;
end;
$$;

rollback;
