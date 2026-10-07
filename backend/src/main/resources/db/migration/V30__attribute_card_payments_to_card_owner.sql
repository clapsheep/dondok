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

-- Purchase corrections historically removed zeroed payment rows but kept their
-- soft-deleted transfers and postings. Attribute those only when the posting
-- identifies exactly one credit card; never infer from the author or funding account.
with cancelled_payment_cards as (
    select transaction.id, min(card.owner_member_id::text)::uuid as owner_member_id
      from ledger_transaction transaction
      join transaction_posting posting
        on posting.book_id = transaction.book_id and posting.transaction_id = transaction.id
      join asset card on card.book_id = posting.book_id and card.id = posting.asset_id
      join asset_type type on type.book_id = card.book_id and type.id = card.asset_type_id
     where transaction.transaction_type = 'TRANSFER'
       and transaction.transfer_subtype in ('CARD_SETTLEMENT', 'CARD_PREPAYMENT')
       and transaction.source_type in ('CARD_AUTOPAY', 'CARD_PREPAYMENT')
       and transaction.performed_by_member_id is null
       and transaction.deleted_at is not null
       and type.behavior = 'CREDIT_CARD'
       and not exists (select 1 from card_statement_payment payment
                        where payment.book_id = transaction.book_id
                          and payment.settlement_transaction_id = transaction.id)
     group by transaction.id
    having count(distinct card.id) = 1
)
update ledger_transaction transaction
   set performed_by_member_id = candidate.owner_member_id,
       updated_at = now(), version = transaction.version + 1
  from cancelled_payment_cards candidate
 where transaction.id = candidate.id;

-- Active unlinked or ambiguously attributed legacy payments still fail migration.
alter table ledger_transaction add constraint ck_ledger_transaction_performer
    check (
        (transaction_type = 'ADJUSTMENT' and performed_by_member_id is null)
        or (transaction_type in ('INCOME', 'EXPENSE', 'TRANSFER') and performed_by_member_id is not null)
    );
