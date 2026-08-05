insert into app_user (id, display_name, email)
values ('00000000-0000-7000-8000-000000001701', '초대 마이그레이션 사용자', 'invite-v17@example.test');

insert into ledger_book (id, created_by_user_id)
values ('00000000-0000-7000-8000-000000001710', '00000000-0000-7000-8000-000000001701');

insert into ledger_member (id, book_id, user_id)
values (
    '00000000-0000-7000-8000-000000001711',
    '00000000-0000-7000-8000-000000001710',
    '00000000-0000-7000-8000-000000001701'
);

insert into ledger_invitation (id, book_id, inviter_member_id, code_digest)
values (
    '00000000-0000-7000-8000-000000001720',
    '00000000-0000-7000-8000-000000001710',
    '00000000-0000-7000-8000-000000001711',
    repeat('a', 64)
);
