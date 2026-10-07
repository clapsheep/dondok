alter table card_statement_payment drop constraint ck_card_statement_payment_type;
alter table card_statement_payment drop constraint ck_card_statement_payment_creator;
alter table card_statement_payment
    add constraint ck_card_statement_payment_type check (payment_type in ('PREPAYMENT', 'REGULAR', 'MANUAL')),
    add constraint ck_card_statement_payment_creator check (
        payment_type = 'REGULAR'
        or (payment_type in ('PREPAYMENT', 'MANUAL') and created_by_member_id is not null)
    );
comment on column card_statement_payment.payment_type is
    'PREPAYMENT: before-due partial payment; REGULAR: scheduled automatic payment; MANUAL: user-initiated full remaining payment on the execution date.';
