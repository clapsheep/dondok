alter table ledger_transaction
    drop constraint ck_ledger_transaction_source;

alter table ledger_transaction
    add constraint ck_ledger_transaction_source
        check (source_type in (
            'MANUAL',
            'IMPORT',
            'CARD_AUTOPAY',
            'CARD_PREPAYMENT',
            'CARD_REFUND',
            'OPENING_BALANCE',
            'SYSTEM'
        ));

create table card_purchase_billing_snapshot (
    purchase_transaction_id       uuid primary key,
    book_id                       uuid not null references ledger_book(id) on delete cascade,
    card_asset_id                 uuid not null,
    statement_closing_day         smallint not null,
    payment_day                   smallint not null,
    payment_month_offset          smallint not null,
    installment_count             smallint not null,
    created_at                    timestamptz not null default now(),
    updated_at                    timestamptz not null default now(),

    constraint uq_card_purchase_billing_snapshot_book_id
        unique (book_id, purchase_transaction_id),
    constraint fk_card_purchase_billing_snapshot_transaction
        foreign key (book_id, purchase_transaction_id)
        references ledger_transaction(book_id, id) on delete cascade,
    constraint fk_card_purchase_billing_snapshot_asset
        foreign key (book_id, card_asset_id)
        references asset(book_id, id),
    constraint ck_card_purchase_billing_snapshot_days
        check (statement_closing_day between 1 and 31 and payment_day between 1 and 31),
    constraint ck_card_purchase_billing_snapshot_offset
        check (payment_month_offset between 0 and 2),
    constraint ck_card_purchase_billing_snapshot_installments
        check (installment_count between 1 and 60)
);

insert into card_purchase_billing_snapshot (
    purchase_transaction_id,
    book_id,
    card_asset_id,
    statement_closing_day,
    payment_day,
    payment_month_offset,
    installment_count,
    created_at,
    updated_at
)
select
    purchase.id,
    purchase.book_id,
    min(charge.card_asset_id::text)::uuid,
    setting.statement_closing_day,
    setting.payment_day,
    setting.payment_month_offset,
    max(charge.installment_count),
    purchase.created_at,
    now()
from ledger_transaction purchase
join card_charge charge
  on charge.book_id = purchase.book_id
 and charge.source_transaction_id = purchase.id
 and charge.charge_origin = 'PURCHASE'
join card_setting setting
  on setting.book_id = charge.book_id
 and setting.card_asset_id = charge.card_asset_id
where purchase.deleted_at is null
group by purchase.id, purchase.book_id, setting.statement_closing_day,
         setting.payment_day, setting.payment_month_offset, purchase.created_at
on conflict (purchase_transaction_id) do nothing;

create table card_purchase_refund (
    id                            uuid primary key,
    book_id                       uuid not null references ledger_book(id) on delete cascade,
    purchase_transaction_id       uuid not null,
    refund_transaction_id         uuid not null,
    refunded_on                   date not null,
    amount_won                    bigint not null,
    created_by_member_id          uuid not null,
    created_at                    timestamptz not null default now(),

    constraint uq_card_purchase_refund_book_id
        unique (book_id, id),
    constraint uq_card_purchase_refund_transaction
        unique (refund_transaction_id),
    constraint fk_card_purchase_refund_purchase
        foreign key (book_id, purchase_transaction_id)
        references ledger_transaction(book_id, id),
    constraint fk_card_purchase_refund_transaction
        foreign key (book_id, refund_transaction_id)
        references ledger_transaction(book_id, id),
    constraint fk_card_purchase_refund_creator
        foreign key (book_id, created_by_member_id)
        references ledger_member(book_id, id),
    constraint ck_card_purchase_refund_amount
        check (amount_won > 0)
);

create index ix_card_purchase_refund_purchase
    on card_purchase_refund(book_id, purchase_transaction_id, refunded_on, id);

create table card_purchase_refund_charge (
    book_id                       uuid not null references ledger_book(id) on delete cascade,
    refund_id                    uuid not null,
    card_charge_id               uuid not null,
    amount_won                   bigint not null,

    constraint pk_card_purchase_refund_charge
        primary key (refund_id, card_charge_id),
    constraint fk_card_purchase_refund_charge_refund
        foreign key (book_id, refund_id)
        references card_purchase_refund(book_id, id) on delete cascade,
    constraint fk_card_purchase_refund_charge_charge
        foreign key (book_id, card_charge_id)
        references card_charge(book_id, id),
    constraint ck_card_purchase_refund_charge_amount
        check (amount_won > 0)
);

create index ix_card_purchase_refund_charge_charge
    on card_purchase_refund_charge(card_charge_id, refund_id);

create table card_purchase_refund_payment (
    book_id                       uuid not null references ledger_book(id) on delete cascade,
    refund_id                    uuid not null,
    statement_payment_id         uuid not null,
    amount_won                   bigint not null,

    constraint pk_card_purchase_refund_payment
        primary key (refund_id, statement_payment_id),
    constraint fk_card_purchase_refund_payment_refund
        foreign key (book_id, refund_id)
        references card_purchase_refund(book_id, id) on delete cascade,
    constraint fk_card_purchase_refund_payment_payment
        foreign key (book_id, statement_payment_id)
        references card_statement_payment(book_id, id),
    constraint ck_card_purchase_refund_payment_amount
        check (amount_won > 0)
);

create index ix_card_purchase_refund_payment_payment
    on card_purchase_refund_payment(statement_payment_id, refund_id);

drop view card_statement_forecast;

create view card_statement_forecast as
with charge_totals as (
    select
        charge.statement_id,
        coalesce(sum(charge.principal_amount_won), 0)
            - coalesce(sum(refunded.refunded_amount_won), 0) as charge_amount_won
    from card_charge charge
    join ledger_transaction purchase
      on purchase.book_id = charge.book_id
     and purchase.id = charge.source_transaction_id
     and purchase.deleted_at is null
    left join lateral (
        select sum(allocation.amount_won) as refunded_amount_won
        from card_purchase_refund_charge allocation
        where allocation.card_charge_id = charge.id
    ) refunded on true
    group by charge.statement_id
), payment_totals as (
    select
        payment.statement_id,
        coalesce(sum(payment.amount_won), 0)
            - coalesce(sum(returned.returned_amount_won), 0) as paid_amount_won
    from card_statement_payment payment
    join ledger_transaction settlement
      on settlement.book_id = payment.book_id
     and settlement.id = payment.settlement_transaction_id
     and settlement.deleted_at is null
    left join lateral (
        select sum(allocation.amount_won) as returned_amount_won
        from card_purchase_refund_payment allocation
        where allocation.statement_payment_id = payment.id
    ) returned on true
    group by payment.statement_id
)
select
    statement.id as statement_id,
    statement.book_id,
    statement.card_asset_id,
    statement.due_on,
    statement.status,
    greatest(coalesce(charge_totals.charge_amount_won, 0), 0) as gross_amount_won,
    greatest(coalesce(payment_totals.paid_amount_won, 0), 0) as paid_amount_won,
    greatest(
        coalesce(charge_totals.charge_amount_won, 0)
            - coalesce(payment_totals.paid_amount_won, 0),
        0
    ) as payment_amount_won
from card_statement statement
left join charge_totals
  on charge_totals.statement_id = statement.id
left join payment_totals
  on payment_totals.statement_id = statement.id;

create view ledger_financial_activity as
select
    transaction.id as transaction_id,
    transaction.book_id,
    transaction.occurred_on,
    transaction.transaction_type,
    transaction.category_id,
    transaction.performed_by_member_id,
    case
        when transaction.transaction_type = 'EXPENSE'
         and transaction.source_type = 'CARD_REFUND'
            then -transaction.amount_won
        else transaction.amount_won
    end as statistics_amount_won
from ledger_transaction transaction
where transaction.deleted_at is null
  and transaction.transaction_type in ('INCOME', 'EXPENSE');

