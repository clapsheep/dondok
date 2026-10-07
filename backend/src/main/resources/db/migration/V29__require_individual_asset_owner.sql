-- Never infer an owner for existing joint assets, including archived assets.
-- Assign their owners explicitly using the previous application before retrying.
do $$
begin
    if exists (select 1 from asset where ownership_scope <> 'PERSONAL' or owner_member_id is null) then
        raise exception 'Individual asset owners must be assigned before applying V29';
    end if;
end $$;

alter table asset drop constraint ck_asset_ownership;
alter table asset alter column owner_member_id set not null;
alter table asset add constraint ck_asset_ownership check (ownership_scope = 'PERSONAL');

comment on column asset.ownership_scope is
    'Compatibility field fixed to PERSONAL; every asset belongs to one ledger member';
