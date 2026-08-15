update card_payment_schedule schedule
   set status = 'CANCELLED',
       last_error = null,
       next_retry_at = null,
       updated_at = now(),
       version = schedule.version + 1
  from card_statement statement,
       asset card
 where schedule.book_id = statement.book_id
   and schedule.statement_id = statement.id
   and card.book_id = statement.book_id
   and card.id = statement.card_asset_id
   and card.archived_at is not null
   and schedule.status in ('SCHEDULED', 'PROCESSING', 'FAILED');

comment on column asset.archived_at is
    'Internal retention state exposed to users as asset usage ended; new transactions and card settlements are disabled';
