alter table asset_type
    drop constraint ck_asset_type_behavior;

alter table asset_type
    add constraint ck_asset_type_behavior
        check (behavior in ('STANDARD', 'CREDIT_CARD', 'DEBIT_CARD', 'SAVINGS'));

update asset_type
   set behavior = case system_code
       when 'DEBIT_CARD' then 'DEBIT_CARD'
       when 'SAVINGS' then 'SAVINGS'
       else behavior
   end
 where system_code in ('DEBIT_CARD', 'SAVINGS');

create table debit_card_setting (
    debit_card_asset_id        uuid primary key,
    book_id                    uuid not null references ledger_book(id) on delete cascade,
    payment_asset_id           uuid not null,
    created_at                 timestamptz not null default now(),
    updated_at                 timestamptz not null default now(),
    version                    bigint not null default 0,

    constraint fk_debit_card_setting_asset
        foreign key (book_id, debit_card_asset_id)
        references asset(book_id, id) on delete cascade,
    constraint fk_debit_card_setting_payment_asset
        foreign key (book_id, payment_asset_id)
        references asset(book_id, id),
    constraint ck_debit_card_setting_distinct_assets
        check (debit_card_asset_id <> payment_asset_id)
);

create index ix_debit_card_setting_payment_asset
    on debit_card_setting(book_id, payment_asset_id);

create table savings_setting (
    savings_asset_id           uuid primary key,
    book_id                    uuid not null references ledger_book(id) on delete cascade,
    transfer_asset_id          uuid not null,
    transfer_day               smallint not null,
    created_at                 timestamptz not null default now(),
    updated_at                 timestamptz not null default now(),
    version                    bigint not null default 0,

    constraint fk_savings_setting_asset
        foreign key (book_id, savings_asset_id)
        references asset(book_id, id) on delete cascade,
    constraint fk_savings_setting_transfer_asset
        foreign key (book_id, transfer_asset_id)
        references asset(book_id, id),
    constraint ck_savings_setting_distinct_assets
        check (savings_asset_id <> transfer_asset_id),
    constraint ck_savings_setting_transfer_day
        check (transfer_day between 1 and 31)
);

create index ix_savings_setting_transfer_asset
    on savings_setting(book_id, transfer_asset_id);

alter table ledger_transaction
    add column primary_asset_id uuid;

update ledger_transaction transaction
   set primary_asset_id = source.asset_id
  from (
      select distinct on (posting.transaction_id)
             posting.transaction_id, posting.asset_id
        from transaction_posting posting
        join ledger_transaction source_transaction
          on source_transaction.book_id = posting.book_id
         and source_transaction.id = posting.transaction_id
       where source_transaction.transaction_type in ('INCOME', 'EXPENSE')
       order by posting.transaction_id, posting.line_no
  ) source
 where transaction.id = source.transaction_id;

alter table ledger_transaction
    add constraint fk_ledger_transaction_primary_asset
        foreign key (book_id, primary_asset_id)
        references asset(book_id, id),
    add constraint ck_ledger_transaction_primary_asset
        check (
            (transaction_type in ('INCOME', 'EXPENSE') and primary_asset_id is not null)
            or
            (transaction_type in ('TRANSFER', 'ADJUSTMENT') and primary_asset_id is null)
        );

create index ix_ledger_transaction_primary_asset
    on ledger_transaction(book_id, primary_asset_id, occurred_on desc)
    where primary_asset_id is not null and deleted_at is null;
