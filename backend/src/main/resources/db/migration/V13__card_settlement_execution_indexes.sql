drop index if exists ix_card_payment_schedule_due;

create index ix_card_payment_schedule_due
    on card_payment_schedule(scheduled_on, next_retry_at, id)
    where status in ('SCHEDULED', 'FAILED');

create index ix_card_statement_asset_due
    on card_statement(card_asset_id, due_on desc, id desc)
    where status in ('OPEN', 'FINALIZED', 'PAID');
