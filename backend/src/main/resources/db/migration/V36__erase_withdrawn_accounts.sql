alter table ledger_member alter column user_id drop not null;
create unique index uq_ledger_system_member on ledger_member(book_id) where user_id is null;
alter table ledger_book alter column created_by_user_id drop not null;
alter table ledger_book drop constraint ledger_book_created_by_user_id_fkey;
alter table ledger_book add constraint ledger_book_created_by_user_id_fkey
    foreign key (created_by_user_id) references app_user(id) on delete set null;

-- The application verifies the password/snapshot and locks user -> book before calling.
-- Reused by the migration so legacy tombstoned accounts receive the same erasure.
create function erase_ledger_account(target_user uuid) returns void language plpgsql as $$
declare
    departed ledger_member%rowtype;
    marker uuid;
    ref record;
    redacted_asset record;
    redacted_category record;
    label_no integer := 1;
begin
    select * into departed from ledger_member where user_id = target_user;
    if departed.id is not null then
        if not exists (select 1 from ledger_member m join app_user u on u.id = m.user_id
                       where m.book_id = departed.book_id and u.id <> target_user and u.status <> 'WITHDRAWN') then
            delete from ledger_book where id = departed.book_id;
        else
            insert into ledger_member(id, book_id, user_id, joined_at)
                values(gen_random_uuid(), departed.book_id, null, '1970-01-01T00:00:00Z')
                on conflict (book_id) where user_id is null do nothing;
            select id into marker from ledger_member where book_id = departed.book_id and user_id is null;

            -- No old member -> marker mapping, invitation identity, or response snapshots survive.
            delete from ledger_invitation_redemption where user_id = target_user;
            delete from ledger_invitation where inviter_member_id = departed.id;
            delete from api_idempotency where book_id = departed.book_id;
            delete from audit_log where book_id = departed.book_id or actor_member_id = departed.id;
            update ledger_transaction set description = null, version = version + 1, updated_at = now()
                where book_id = departed.book_id and departed.id in
                      (performed_by_member_id, created_by_member_id, updated_by_member_id, deleted_by_member_id);
            for redacted_asset in select id from asset where book_id = departed.book_id
                and departed.id in (owner_member_id, created_by_member_id, updated_by_member_id, archived_by_member_id)
                order by id loop
                while exists (select 1 from asset where book_id = departed.book_id and name = '기록 자산 ' || label_no) loop
                    label_no := label_no + 1;
                end loop;
                update asset set name = '기록 자산 ' || label_no, memo = null,
                    version = version + 1, updated_at = now() where id = redacted_asset.id;
                label_no := label_no + 1;
            end loop;
            update category set version = version + 1, updated_at = now()
                where book_id = departed.book_id and departed.id in (created_by_member_id, updated_by_member_id);
            label_no := 1;
            for redacted_category in select id, kind from category where book_id = departed.book_id
                and departed.id in (created_by_member_id, updated_by_member_id)
                and name is distinct from case system_code
                    when 'OTHER' then case kind when 'INCOME' then '기타 수입' else '기타 지출' end
                    when 'FOOD' then '식비' when 'TRANSPORT' then '교통비' when 'GROCERIES' then '장보기'
                    when 'HOUSING' then '주거비' when 'TELECOM' then '통신비' when 'FAMILY_EVENT' then '경조사비'
                    when 'EDUCATION' then '교육비' when 'MEDICAL' then '의료비' when 'SUBSCRIPTION' then '구독비'
                    when 'HOUSEHOLD' then '생필품' when 'LEISURE' then '여가생활' end
                order by id loop
                while exists (select 1 from category where book_id = departed.book_id
                    and kind = redacted_category.kind and name = '기록 분류 ' || label_no) loop
                    label_no := label_no + 1;
                end loop;
                update category set name = '기록 분류 ' || label_no where id = redacted_category.id;
                label_no := label_no + 1;
            end loop;
            update asset_type set version = version + 1, updated_at = now()
                where book_id = departed.book_id and created_by_member_id = departed.id;

            -- Explicit allowlist: a newly introduced member FK must be considered before erasure can succeed.
            for ref in select * from (values
                ('asset_type','created_by_member_id'),
                ('category','created_by_member_id'), ('category','updated_by_member_id'),
                ('asset','owner_member_id'), ('asset','created_by_member_id'),
                ('asset','updated_by_member_id'), ('asset','archived_by_member_id'),
                ('ledger_transaction','performed_by_member_id'), ('ledger_transaction','created_by_member_id'),
                ('ledger_transaction','updated_by_member_id'), ('ledger_transaction','deleted_by_member_id'),
                ('card_statement_payment','created_by_member_id'), ('card_statement_payment','cancelled_by_member_id'),
                ('card_purchase_refund','created_by_member_id')
            ) as refs(table_name, column_name) loop
                execute format('update %I set %I = $1 where %I = $2', ref.table_name, ref.column_name, ref.column_name)
                    using marker, departed.id;
            end loop;
            delete from ledger_member where id = departed.id;
            update ledger_book set version = version + 1, updated_at = now() where id = departed.book_id;
        end if;
    end if;
    delete from spring_session where principal_name in
        (select login_id_normalized from local_credential where user_id = target_user);
    delete from api_idempotency where actor_user_id = target_user;
    delete from app_user where id = target_user;
end;
$$;

-- Forward-only erasure of previous soft-withdrawal accounts.
do $$ declare candidate uuid; begin
    for candidate in select id from app_user where status = 'WITHDRAWN' loop
        perform erase_ledger_account(candidate);
    end loop;
end $$;
