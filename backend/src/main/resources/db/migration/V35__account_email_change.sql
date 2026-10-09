-- One current challenge per account; user row locks serialize issuance, verification and saving.
CREATE TABLE account_email_change (
    user_id UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
    email VARCHAR(320) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    profile_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (expires_at > created_at)
);
