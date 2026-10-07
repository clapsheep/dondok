-- Automatic execution is retired; retain all historical payments and postings.
update card_setting set auto_settlement_enabled = false where auto_settlement_enabled;
alter table card_setting add constraint ck_card_no_automatic_settlement check (not auto_settlement_enabled);
update card_payment_schedule set status = 'CANCELLED', last_error = null, next_retry_at = null,
    updated_at = now(), version = version + 1 where status in ('SCHEDULED', 'PROCESSING', 'FAILED');

create table card_payment_item_allocation (
    book_id uuid not null,
    payment_id uuid not null,
    source_transaction_id uuid not null,
    installment_no smallint not null check (installment_no > 0),
    amount_won bigint not null check (amount_won > 0),
    primary key (payment_id, source_transaction_id, installment_no),
    foreign key (book_id, payment_id) references card_statement_payment(book_id, id) on delete cascade,
    foreign key (book_id, source_transaction_id) references ledger_transaction(book_id, id) on delete cascade
);
create index ix_card_payment_item_purchase on card_payment_item_allocation(source_transaction_id, installment_no);

-- A scoped projection: no financial data is copied or cached. Historical pooled payments
-- and the existing statement-first refund/correction policy remain authoritative.
create function card_payable_items(p_book uuid, p_card uuid)
returns table (
    charge_id uuid, statement_id uuid, source_transaction_id uuid, installment_no smallint,
    installment_count smallint, occurred_on date, description text, cycle_end date, due_on date,
    remaining_amount_won bigint, origin text
) language sql stable as $$
with charges as (
    select c.id, c.statement_id, c.source_transaction_id, c.installment_no, c.installment_count,
        t.occurred_on, coalesce(t.description, cat.name, '기준일 미결제금')::text description,
        s.cycle_end, s.due_on, c.charge_origin::text origin,
        greatest(0, c.principal_amount_won - coalesce(r.amount, 0) - coalesce(ar.amount, 0))::bigint net
    from card_charge c
    join ledger_transaction t on t.book_id = c.book_id and t.id = c.source_transaction_id and t.deleted_at is null
    join card_statement s on s.book_id = c.book_id and s.id = c.statement_id
    left join category cat on cat.book_id = t.book_id and cat.id = t.category_id
    left join lateral (select sum(amount_won) amount from card_purchase_refund_charge where card_charge_id = c.id) r on true
    left join lateral (
        select sum(a.amount_won) amount from card_purchase_refund_charge a
        join card_charge absorbed on absorbed.book_id = a.book_id and absorbed.id = a.card_charge_id
        join card_purchase_refund refund on refund.book_id = a.book_id and refund.id = a.refund_id
        join asset card on card.book_id = absorbed.book_id and card.id = absorbed.card_asset_id
        where c.charge_origin = 'OPENING_BALANCE' and absorbed.absorbed_by_balance_anchor
          and absorbed.card_asset_id = c.card_asset_id and refund.refunded_on >= card.opened_on
    ) ar on true
    where c.book_id = p_book and c.card_asset_id = p_card and not c.absorbed_by_balance_anchor
      and s.status <> 'CANCELLED'
), allocations as (
    select a.*, p.statement_id,
        greatest(0, p.amount_won - coalesce(r.amount, 0)) effective,
        coalesce(sum(a.amount_won) over (partition by p.id order by a.source_transaction_id, a.installment_no
            rows between unbounded preceding and 1 preceding), 0) previous
    from card_payment_item_allocation a
    join card_statement_payment p on p.book_id = a.book_id and p.id = a.payment_id and p.cancelled_at is null
    join ledger_transaction t on t.book_id = p.book_id and t.id = p.settlement_transaction_id and t.deleted_at is null
    join card_statement s on s.book_id = p.book_id and s.id = p.statement_id and s.card_asset_id = p_card
    left join lateral (select sum(amount_won) amount from card_purchase_refund_payment where statement_payment_id = p.id) r on true
    where a.book_id = p_book
), pinned as (
    select c.*, least(c.net, coalesce((select sum(least(a.amount_won, greatest(0, a.effective - a.previous)))
        from allocations a where a.statement_id = c.statement_id
          and a.source_transaction_id = c.source_transaction_id and a.installment_no = c.installment_no), 0))::bigint paid
    from charges c
), pools as (
    select c.*, greatest(0, f.paid_amount_won - sum(c.paid) over (partition by c.statement_id)) pool,
        coalesce(sum(c.net - c.paid) over (partition by c.statement_id order by c.occurred_on, c.id
            rows between unbounded preceding and 1 preceding), 0) previous
    from pinned c join card_statement_forecast f on f.statement_id = c.statement_id
)
select id, statement_id, source_transaction_id, installment_no, installment_count,
    occurred_on, description, cycle_end, due_on,
    greatest(0, net - paid - greatest(0, pool - previous))::bigint, origin
from pools;
$$;
alter table card_statement_payment add column user_payment_batch_id uuid;
create index ix_card_payment_user_batch on card_statement_payment(book_id, user_payment_batch_id)
    where user_payment_batch_id is not null;
