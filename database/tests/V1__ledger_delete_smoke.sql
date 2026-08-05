begin;

insert into app_user (id, display_name, email)
values
    ('00000000-0000-7000-8000-000000000101', '삭제 사용자 1', 'delete1@example.test'),
    ('00000000-0000-7000-8000-000000000102', '삭제 사용자 2', 'delete2@example.test');

insert into local_credential (user_id, login_id, password_hash)
values
    ('00000000-0000-7000-8000-000000000101', 'delete_user_1', 'not-a-real-password-hash'),
    ('00000000-0000-7000-8000-000000000102', 'delete_user_2', 'not-a-real-password-hash');

insert into ledger_book (id, created_by_user_id)
values (
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000101'
);

insert into ledger_member (id, book_id, user_id)
values
    ('00000000-0000-7000-8000-000000000111', '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000101'),
    ('00000000-0000-7000-8000-000000000112', '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000102');

insert into ledger_invitation (
    id,
    book_id,
    inviter_member_id,
    link_token_digest,
    direct_code_digest,
    status,
    redeemed_at
)
values (
    '00000000-0000-7000-8000-000000000120',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000111',
    repeat('b', 64),
    repeat('d', 64),
    'REDEEMED',
    now()
);

insert into ledger_invitation_redemption (
    book_id,
    invitation_id,
    user_id,
    member_id
)
values (
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000120',
    '00000000-0000-7000-8000-000000000102',
    '00000000-0000-7000-8000-000000000112'
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
    ('00000000-0000-7000-8000-000000000131', '00000000-0000-7000-8000-000000000110', 'BANK', '계좌', 'STANDARD', true, '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000132', '00000000-0000-7000-8000-000000000110', 'CREDIT_CARD', '신용카드', 'CREDIT_CARD', false, '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000133', '00000000-0000-7000-8000-000000000110', 'DEBIT_CARD', '체크카드', 'DEBIT_CARD', false, '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000134', '00000000-0000-7000-8000-000000000110', 'SAVINGS', '적금', 'SAVINGS', true, '00000000-0000-7000-8000-000000000111');

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
    ('00000000-0000-7000-8000-000000000141', '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000131', 'PERSONAL', '00000000-0000-7000-8000-000000000111', '삭제 은행', '2026-01-01', '00000000-0000-7000-8000-000000000111', '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000142', '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000132', 'PERSONAL', '00000000-0000-7000-8000-000000000112', '삭제 카드', '2026-01-01', '00000000-0000-7000-8000-000000000112', '00000000-0000-7000-8000-000000000112'),
    ('00000000-0000-7000-8000-000000000143', '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000133', 'PERSONAL', '00000000-0000-7000-8000-000000000111', '삭제 체크카드', '2026-01-01', '00000000-0000-7000-8000-000000000111', '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000144', '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000134', 'JOINT', null, '삭제 적금', '2026-01-01', '00000000-0000-7000-8000-000000000112', '00000000-0000-7000-8000-000000000112');

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
    '00000000-0000-7000-8000-000000000142',
    '00000000-0000-7000-8000-000000000110',
    15,
    25,
    1,
    '00000000-0000-7000-8000-000000000141',
    true
);

insert into debit_card_setting (
    debit_card_asset_id,
    book_id,
    payment_asset_id
)
values (
    '00000000-0000-7000-8000-000000000143',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000141'
);

insert into savings_setting (
    savings_asset_id,
    book_id,
    transfer_asset_id,
    transfer_day
)
values (
    '00000000-0000-7000-8000-000000000144',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000141',
    20
);

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
values (
    '00000000-0000-7000-8000-000000000151',
    '00000000-0000-7000-8000-000000000110',
    'EXPENSE',
    'OTHER',
    true,
    '기타 지출',
    '00000000-0000-7000-8000-000000000111',
    '00000000-0000-7000-8000-000000000111'
);

insert into ledger_transaction (
    id,
    book_id,
    transaction_type,
    transfer_subtype,
    occurred_on,
    amount_won,
    category_id,
    performed_by_member_id,
    primary_asset_id,
    source_type,
    source_id,
    created_by_member_id
)
values
    ('00000000-0000-7000-8000-000000000161', '00000000-0000-7000-8000-000000000110', 'EXPENSE', null, '2026-07-01', 100, '00000000-0000-7000-8000-000000000151', '00000000-0000-7000-8000-000000000112', '00000000-0000-7000-8000-000000000142', 'MANUAL', null, '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000162', '00000000-0000-7000-8000-000000000110', 'EXPENSE', null, '2026-07-10', 40, '00000000-0000-7000-8000-000000000151', '00000000-0000-7000-8000-000000000112', '00000000-0000-7000-8000-000000000142', 'CARD_REFUND', null, '00000000-0000-7000-8000-000000000111'),
    ('00000000-0000-7000-8000-000000000171', '00000000-0000-7000-8000-000000000110', 'TRANSFER', 'CARD_SETTLEMENT', '2026-08-25', 100, null, null, null, 'CARD_AUTOPAY', '00000000-0000-7000-8000-000000000170', null);

insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
values
    ('00000000-0000-7000-8000-000000000161', 1, '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000142', -100),
    ('00000000-0000-7000-8000-000000000162', 1, '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000142', 40),
    ('00000000-0000-7000-8000-000000000171', 1, '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000141', -100),
    ('00000000-0000-7000-8000-000000000171', 2, '00000000-0000-7000-8000-000000000110', '00000000-0000-7000-8000-000000000142', 100);

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
values (
    '00000000-0000-7000-8000-000000000170',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000142',
    '2026-06-16',
    '2026-07-15',
    '2026-08-25',
    'PAID',
    100,
    now(),
    now()
);

insert into card_charge (
    id,
    book_id,
    source_transaction_id,
    card_asset_id,
    statement_id,
    principal_amount_won,
    expected_settlement_on
)
values (
    '00000000-0000-7000-8000-000000000174',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000161',
    '00000000-0000-7000-8000-000000000142',
    '00000000-0000-7000-8000-000000000170',
    100,
    '2026-08-25'
);

insert into card_purchase_billing_snapshot (
    purchase_transaction_id,
    book_id,
    card_asset_id,
    statement_closing_day,
    payment_day,
    payment_month_offset,
    installment_count
)
values (
    '00000000-0000-7000-8000-000000000161',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000142',
    15,
    25,
    1,
    1
);

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
    '00000000-0000-7000-8000-000000000172',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000170',
    '00000000-0000-7000-8000-000000000141',
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
    settlement_transaction_id
)
values (
    '00000000-0000-7000-8000-000000000180',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000170',
    'REGULAR',
    '00000000-0000-7000-8000-000000000141',
    100,
    '2026-08-25',
    '00000000-0000-7000-8000-000000000171'
);

insert into card_purchase_refund (
    id,
    book_id,
    purchase_transaction_id,
    refund_transaction_id,
    refunded_on,
    amount_won,
    created_by_member_id
)
values (
    '00000000-0000-7000-8000-000000000190',
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000161',
    '00000000-0000-7000-8000-000000000162',
    '2026-07-10',
    40,
    '00000000-0000-7000-8000-000000000111'
);

insert into card_purchase_refund_charge (
    book_id,
    refund_id,
    card_charge_id,
    amount_won
)
values (
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000190',
    '00000000-0000-7000-8000-000000000174',
    40
);

insert into card_purchase_refund_payment (
    book_id,
    refund_id,
    statement_payment_id,
    amount_won
)
values (
    '00000000-0000-7000-8000-000000000110',
    '00000000-0000-7000-8000-000000000190',
    '00000000-0000-7000-8000-000000000180',
    40
);

insert into api_idempotency (
    id,
    actor_user_id,
    book_id,
    endpoint_scope,
    idempotency_key,
    request_hash,
    expires_at
)
values (
    '00000000-0000-7000-8000-000000000195',
    '00000000-0000-7000-8000-000000000101',
    '00000000-0000-7000-8000-000000000110',
    'ledger-delete-smoke',
    'ledger-delete-smoke-key',
    repeat('c', 64),
    now() + interval '1 day'
);

insert into audit_log (
    book_id,
    actor_type,
    actor_member_id,
    entity_type,
    entity_id,
    action
)
values (
    '00000000-0000-7000-8000-000000000110',
    'USER',
    '00000000-0000-7000-8000-000000000111',
    'LEDGER',
    '00000000-0000-7000-8000-000000000110',
    'DELETE_REQUESTED'
);

delete from ledger_book
where id = '00000000-0000-7000-8000-000000000110';

do $$
begin
    if exists (select 1 from ledger_book where id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from ledger_member where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from ledger_invitation where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from ledger_invitation_redemption where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from asset_type where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from asset where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_setting where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from debit_card_setting where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from savings_setting where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from category where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from ledger_transaction where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from transaction_posting where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_statement where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_charge where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_payment_schedule where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_statement_payment where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_purchase_billing_snapshot where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_purchase_refund where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_purchase_refund_charge where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from card_purchase_refund_payment where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from api_idempotency where book_id = '00000000-0000-7000-8000-000000000110')
       or exists (select 1 from audit_log where book_id = '00000000-0000-7000-8000-000000000110') then
        raise exception 'ledger cascade check failed';
    end if;

    if (select count(*) from app_user where id in (
            '00000000-0000-7000-8000-000000000101',
            '00000000-0000-7000-8000-000000000102'
        )) <> 2
       or (select count(*) from local_credential where user_id in (
            '00000000-0000-7000-8000-000000000101',
            '00000000-0000-7000-8000-000000000102'
        )) <> 2 then
        raise exception 'ledger deletion removed account data';
    end if;
end;
$$;

rollback;
