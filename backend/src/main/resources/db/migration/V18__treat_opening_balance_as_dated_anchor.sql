alter table asset
    add column balance_anchor_won bigint;

-- Preserve every asset's displayed balance while changing the meaning of the
-- stored amount.  The previous opening posting plus all active postings before
-- opened_on is exactly the balance that was already visible at the new anchor.
update asset target
   set balance_anchor_won = coalesce((
           select sum(posting.delta_won)
             from transaction_posting posting
             join ledger_transaction transaction
               on transaction.book_id = posting.book_id
              and transaction.id = posting.transaction_id
            where posting.book_id = target.book_id
              and posting.asset_id = target.id
              and transaction.deleted_at is null
              and (
                    transaction.source_type = 'OPENING_BALANCE'
                    or transaction.occurred_on < target.opened_on
                  )
       ), 0);

alter table asset
    alter column balance_anchor_won set default 0,
    alter column balance_anchor_won set not null;

comment on column asset.opened_on is
    'Start-of-day date at which balance_anchor_won is the declared asset balance';

comment on column asset.balance_anchor_won is
    'Declared balance at the start of opened_on; earlier transactions remain statistical history only';

drop view asset_current_balance;

create view asset_current_balance as
select
    asset.id as asset_id,
    asset.book_id,
    asset.balance_anchor_won + coalesce(
        sum(transaction_posting.delta_won)
            filter (
                where ledger_transaction.deleted_at is null
                  and ledger_transaction.source_type <> 'OPENING_BALANCE'
                  and ledger_transaction.occurred_on >= asset.opened_on
            ),
        0
    ) as current_balance_won
from asset
left join transaction_posting
       on transaction_posting.book_id = asset.book_id
      and transaction_posting.asset_id = asset.id
left join ledger_transaction
       on ledger_transaction.book_id = transaction_posting.book_id
      and ledger_transaction.id = transaction_posting.transaction_id
group by asset.id, asset.book_id, asset.balance_anchor_won;
