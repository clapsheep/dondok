alter table ledger_invitation
    rename column code_digest to link_token_digest;

alter table ledger_invitation
    rename constraint uq_ledger_invitation_code_digest to uq_ledger_invitation_link_token_digest;

alter table ledger_invitation
    rename constraint ck_ledger_invitation_code_digest to ck_ledger_invitation_link_token_digest;

alter table ledger_invitation
    add column direct_code_digest varchar(64);

alter table ledger_invitation
    add constraint uq_ledger_invitation_direct_code_digest
        unique (direct_code_digest),
    add constraint ck_ledger_invitation_direct_code_digest
        check (direct_code_digest is null or direct_code_digest ~ '^[0-9a-f]{64}$');

comment on column ledger_invitation.link_token_digest is
    'SHA-256 digest of the high-entropy token embedded in an invitation URL';

comment on column ledger_invitation.direct_code_digest is
    'SHA-256 digest of the six-digit code shown for manual entry; null only for invitations issued before V17';
