drop view card_statement_forecast;

create view card_statement_forecast as
with charge_totals as (
    select
        charge.statement_id,
        coalesce(sum(charge.principal_amount_won), 0) as principal_amount_won,
        coalesce(sum(refunded.refunded_amount_won), 0) as refunded_amount_won
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
), statement_amounts as (
    select
        statement.id as statement_id,
        case
            when statement.status = 'OPEN' then
                coalesce(charge_totals.principal_amount_won, 0)
                    - coalesce(charge_totals.refunded_amount_won, 0)
            when statement.status in ('FINALIZED', 'PAID') then
                statement.billed_amount_won
                    - coalesce(charge_totals.refunded_amount_won, 0)
            else 0
        end as gross_amount_won,
        coalesce(payment_totals.paid_amount_won, 0) as paid_amount_won
    from card_statement statement
    left join charge_totals
      on charge_totals.statement_id = statement.id
    left join payment_totals
      on payment_totals.statement_id = statement.id
)
select
    statement.id as statement_id,
    statement.book_id,
    statement.card_asset_id,
    statement.due_on,
    statement.status,
    greatest(statement_amounts.gross_amount_won, 0) as gross_amount_won,
    greatest(statement_amounts.paid_amount_won, 0) as paid_amount_won,
    greatest(
        statement_amounts.gross_amount_won - statement_amounts.paid_amount_won,
        0
    ) as payment_amount_won
from card_statement statement
join statement_amounts
  on statement_amounts.statement_id = statement.id;

