package com.dondok.asset.infrastructure.persistence;

import com.dondok.common.id.UuidV7;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AssetIdempotencyRepository {
    private static final String SCOPE = "POST:/api/assets";
    private final JdbcTemplate jdbcTemplate;

    public AssetIdempotencyRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Claim claim(UUID userId, UUID bookId, String key, String requestHash, Instant now) {
        int inserted = jdbcTemplate.update("""
                insert into api_idempotency (
                    id, actor_user_id, book_id, endpoint_scope, idempotency_key,
                    request_hash, processing_status, created_at, expires_at
                ) values (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?)
                on conflict (actor_user_id, endpoint_scope, idempotency_key) do nothing
                """, UuidV7.next(), userId, bookId, SCOPE, key, requestHash,
                Timestamp.from(now), Timestamp.from(now.plus(Duration.ofDays(1))));
        if (inserted == 1) {
            return new Claim(true, requestHash, null, "IN_PROGRESS");
        }
        return jdbcTemplate.queryForObject("""
                select request_hash, resource_id, processing_status
                  from api_idempotency
                 where actor_user_id = ? and endpoint_scope = ? and idempotency_key = ?
                 for update
                """, (rs, rowNum) -> new Claim(
                false,
                rs.getString("request_hash"),
                rs.getObject("resource_id", UUID.class),
                rs.getString("processing_status")), userId, SCOPE, key);
    }

    public void complete(UUID userId, String key, UUID assetId, Instant now) {
        jdbcTemplate.update("""
                update api_idempotency
                   set processing_status = 'COMPLETED', response_status = 201,
                       resource_id = ?, completed_at = ?
                 where actor_user_id = ? and endpoint_scope = ? and idempotency_key = ?
                """, assetId, Timestamp.from(now), userId, SCOPE, key);
    }

    public record Claim(boolean fresh, String requestHash, UUID resourceId, String status) {
    }
}
