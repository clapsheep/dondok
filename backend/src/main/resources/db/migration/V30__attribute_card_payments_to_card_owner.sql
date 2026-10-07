-- Card payments are transfers attributed to the card owner, independently of their funding account.
alter table ledger_transaction drop constraint ck_ledger_transaction_performer;

-- Historical owner snapshots do not exist. Backfill from the linked card's current owner,
-- including cancelled payments, without changing dates, amounts, postings, or authors.
update ledger_transaction transaction
   set performed_by_member_id = card.owner_member_id,
       updated_at = now(), version = transaction.version + 1
  from card_statement_payment payment
  join card_statement statement
    on statement.book_id = payment.book_id and statement.id = payment.statement_id
  join asset card
    on card.book_id = statement.book_id and card.id = statement.card_asset_id
 where transaction.book_id = payment.book_id
   and transaction.id = payment.settlement_transaction_id
   and transaction.transaction_type = 'TRANSFER'
   and transaction.transfer_subtype in ('CARD_SETTLEMENT', 'CARD_PREPAYMENT')
   and transaction.performed_by_member_id is null;

-- An unlinked legacy payment must fail migration rather than silently disappear from member views.
alter table ledger_transaction add constraint ck_ledger_transaction_performer
    check (
        (transaction_type = 'ADJUSTMENT' and performed_by_member_id is null)
        or (transaction_type in ('INCOME', 'EXPENSE', 'TRANSFER') and performed_by_member_id is not null)
    );
