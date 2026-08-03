drop index uq_asset_type_active_name;

alter table asset_type
    drop column name_normalized;

update asset_type
   set behavior = 'STANDARD',
       payment_source_capable = false,
       archived_at = null,
       updated_at = now(),
       version = version + 1
 where system_code = 'OTHER'
   and not is_custom
   and (
       behavior <> 'STANDARD'
       or payment_source_capable
       or archived_at is not null
   );

do $$
begin
    if exists (
        select 1
          from asset
          join asset_type custom_type
            on custom_type.book_id = asset.book_id
           and custom_type.id = asset.asset_type_id
         where custom_type.is_custom
           and not exists (
               select 1
                 from asset_type other_type
                where other_type.book_id = asset.book_id
                  and other_type.system_code = 'OTHER'
                  and not other_type.is_custom
           )
    ) then
        raise exception using
            errcode = '23514',
            message = 'custom asset type cannot be migrated without a system OTHER type in the same ledger';
    end if;
end;
$$;

update asset
   set asset_type_id = other_type.id,
       updated_at = now(),
       version = asset.version + 1
  from asset_type custom_type,
       asset_type other_type
 where custom_type.book_id = asset.book_id
   and custom_type.id = asset.asset_type_id
   and custom_type.is_custom
   and other_type.book_id = asset.book_id
   and other_type.system_code = 'OTHER'
   and not other_type.is_custom;

delete from asset_type
 where is_custom;

update asset_type
   set name = '적금',
       updated_at = now(),
       version = version + 1
 where system_code = 'SAVINGS'
   and name <> '적금';

alter table asset_type
    alter column system_code set not null,
    drop column is_custom,
    add constraint ck_asset_type_system_code_allowed
        check (
            system_code in (
                'CASH',
                'BANK',
                'CREDIT_CARD',
                'DEBIT_CARD',
                'SAVINGS',
                'INVESTMENT',
                'OVERDRAFT',
                'LOAN',
                'INSURANCE',
                'OTHER'
            )
        ),
    add constraint ck_asset_type_other_behavior
        check (
            system_code <> 'OTHER'
            or (
                behavior = 'STANDARD'
                and not payment_source_capable
                and archived_at is null
            )
        );
