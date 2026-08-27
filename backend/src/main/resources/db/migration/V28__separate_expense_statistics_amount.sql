alter table ledger_transaction
    add column statistics_amount_won bigint;

alter table ledger_transaction
    add constraint ck_ledger_transaction_statistics_amount
        check (
            statistics_amount_won is null
            or (
                transaction_type = 'EXPENSE'
                and statistics_amount_won >= 0
                and statistics_amount_won <= amount_won
            )
        );

comment on column ledger_transaction.statistics_amount_won is
    'Optional calendar/statistics amount override for representative expenses; null means amount_won';

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
            then -coalesce(transaction.statistics_amount_won, transaction.amount_won)
        else coalesce(transaction.statistics_amount_won, transaction.amount_won)
    end as statistics_amount_won,
    transaction.primary_asset_id
from ledger_transaction transaction
where transaction.deleted_at is null
  and transaction.transaction_type in ('INCOME', 'EXPENSE')
  and not transaction.excluded_from_statistics;
