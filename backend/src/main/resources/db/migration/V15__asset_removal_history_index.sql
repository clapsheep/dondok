create index ix_ledger_transaction_primary_asset_history
    on ledger_transaction(book_id, primary_asset_id, id)
    where primary_asset_id is not null;
