alter table ledger_transaction add column transfer_purpose varchar(32);
update ledger_transaction set transfer_purpose = 'GENERAL'
 where transaction_type = 'TRANSFER' and transfer_subtype = 'NORMAL';
alter table ledger_transaction add constraint ck_transaction_transfer_purpose check (
    case when transaction_type = 'TRANSFER' and transfer_subtype = 'NORMAL'
    then transfer_purpose is not null and transfer_purpose in (
        'GENERAL', 'SAVINGS_DEPOSIT', 'INVESTMENT_DEPOSIT', 'SAVINGS_WITHDRAWAL', 'INVESTMENT_WITHDRAWAL')
    else transfer_purpose is null end
);
