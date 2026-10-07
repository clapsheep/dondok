-- Preserve the decision across setting changes and later manual payments.
alter table card_statement
    add column additional_usage_after_payment boolean not null default false;

-- Repair statements hidden by the former regular-payment-exists completion branch.
-- Reopen only the statement; historical payment amounts and postings are untouched.
update card_statement statement
   set status = case when statement.due_on > (current_timestamp at time zone 'Asia/Seoul')::date
                     then 'OPEN' else 'FINALIZED' end,
       additional_usage_after_payment = statement.due_on <= (current_timestamp at time zone 'Asia/Seoul')::date,
       finalized_at = case when statement.due_on > (current_timestamp at time zone 'Asia/Seoul')::date
                           then null else coalesce(statement.finalized_at, current_timestamp) end,
       settled_at = null,
       updated_at = current_timestamp, version = statement.version + 1
  from card_statement_forecast forecast
 where forecast.statement_id = statement.id
   and forecast.payment_amount_won > 0
   and (statement.status = 'PAID' or (
       statement.status in ('OPEN', 'FINALIZED')
       and exists (
           select 1 from card_statement_payment payment
           join ledger_transaction transfer on transfer.id = payment.settlement_transaction_id
            and transfer.deleted_at is null
            where payment.statement_id = statement.id and payment.cancelled_at is null
              and payment.payment_type in ('REGULAR', 'MANUAL')
              and exists (
                  select 1 from card_charge charge
                   where charge.statement_id = statement.id
                     and not charge.absorbed_by_balance_anchor
                     and charge.created_at > payment.created_at
                     and (charge.created_at at time zone 'Asia/Seoul')::date >= statement.due_on
              )
       )
   ));

update card_payment_schedule schedule
   set status = 'CANCELLED', last_error = null, next_retry_at = null,
       updated_at = current_timestamp, version = schedule.version + 1
  from card_statement statement
 where schedule.statement_id = statement.id
   and statement.additional_usage_after_payment
   and schedule.status in ('SCHEDULED', 'PROCESSING', 'FAILED');
