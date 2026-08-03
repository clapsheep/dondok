create or replace view ledger_financial_activity as
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
    end as statistics_amount_won,
    transaction.primary_asset_id
from ledger_transaction transaction
where transaction.deleted_at is null
  and transaction.transaction_type in ('INCOME', 'EXPENSE');
