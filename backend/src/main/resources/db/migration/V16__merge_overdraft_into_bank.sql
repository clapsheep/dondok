do $$
begin
    if exists (
        select 1
          from asset_type overdraft_type
         where overdraft_type.system_code = 'OVERDRAFT'
           and not exists (
               select 1
                 from asset_type bank_type
                where bank_type.book_id = overdraft_type.book_id
                  and bank_type.system_code = 'BANK'
                  and bank_type.archived_at is null
           )
    ) then
        raise exception using
            errcode = '23514',
            message = 'OVERDRAFT asset type cannot be migrated without an active BANK type in the same ledger';
    end if;
end;
$$;

update asset
   set asset_type_id = bank_type.id,
       updated_at = now(),
       version = asset.version + 1
  from asset_type overdraft_type,
       asset_type bank_type
 where overdraft_type.book_id = asset.book_id
   and overdraft_type.id = asset.asset_type_id
   and overdraft_type.system_code = 'OVERDRAFT'
   and bank_type.book_id = asset.book_id
   and bank_type.system_code = 'BANK'
   and bank_type.archived_at is null;

delete from asset_type
 where system_code = 'OVERDRAFT';

alter table asset_type
    drop constraint ck_asset_type_system_code_allowed;

alter table asset_type
    add constraint ck_asset_type_system_code_allowed
        check (
            system_code in (
                'CASH',
                'BANK',
                'CREDIT_CARD',
                'DEBIT_CARD',
                'SAVINGS',
                'INVESTMENT',
                'LOAN',
                'INSURANCE',
                'OTHER'
            )
        );
