create index ix_ledger_transaction_category_reference
    on ledger_transaction(book_id, category_id, id)
    include (occurred_on)
    where category_id is not null;
