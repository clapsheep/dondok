-- Historical last-use timestamps are not available; never infer inactivity from signup alone.
alter table app_user add column last_active_at timestamptz not null default now();
alter table app_user add column dormant_at timestamptz;
create index ix_app_user_dormancy on app_user(last_active_at)
    where dormant_at is null and status in ('ACTIVE', 'PENDING_VERIFICATION');
