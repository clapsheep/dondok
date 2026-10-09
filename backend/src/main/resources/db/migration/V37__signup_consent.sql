create table account_consent (
    user_id uuid primary key references app_user(id) on delete cascade,
    document_version varchar(40) not null,
    accepted_at timestamptz not null,
    age_14_or_older boolean not null check (age_14_or_older),
    terms_accepted boolean not null check (terms_accepted),
    privacy_accepted boolean not null check (privacy_accepted)
);
