do $$
begin
    if exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'ledger_invitation'
           and column_name = 'code_digest'
    ) then
        raise exception 'legacy ledger_invitation.code_digest still exists';
    end if;

    if not exists (
        select 1
          from ledger_invitation
         where id = '00000000-0000-7000-8000-000000001720'
           and link_token_digest = repeat('a', 64)
           and direct_code_digest is null
    ) then
        raise exception 'legacy invitation token was not preserved as a link token';
    end if;
end;
$$;

insert into ledger_invitation (
    id, book_id, inviter_member_id, link_token_digest, direct_code_digest
)
values (
    '00000000-0000-7000-8000-000000001721',
    '00000000-0000-7000-8000-000000001710',
    '00000000-0000-7000-8000-000000001711',
    repeat('b', 64),
    repeat('c', 64)
);

do $$
begin
    begin
        insert into ledger_invitation (
            id, book_id, inviter_member_id, link_token_digest, direct_code_digest
        )
        values (
            '00000000-0000-7000-8000-000000001722',
            '00000000-0000-7000-8000-000000001710',
            '00000000-0000-7000-8000-000000001711',
            repeat('d', 64),
            repeat('c', 64)
        );
        raise exception 'duplicate direct invitation code digest was accepted';
    exception
        when unique_violation then null;
    end;

    begin
        insert into ledger_invitation (
            id, book_id, inviter_member_id, link_token_digest, direct_code_digest
        )
        values (
            '00000000-0000-7000-8000-000000001723',
            '00000000-0000-7000-8000-000000001710',
            '00000000-0000-7000-8000-000000001711',
            repeat('e', 64),
            'not-a-digest'
        );
        raise exception 'malformed direct invitation code digest was accepted';
    exception
        when check_violation then null;
    end;
end;
$$;
