package com.dondok.category.infrastructure.persistence;

import com.dondok.category.domain.CategoryKind;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CategoryJdbcRepository {
    private final JdbcTemplate jdbcTemplate;

    public CategoryJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<UUID, Long> transactionUsage(UUID bookId, CategoryKind kind) {
        Map<UUID, Long> usage = new HashMap<>();
        jdbcTemplate.query("""
                select transaction.category_id, count(*) transaction_count
                  from ledger_transaction transaction
                  join category on category.book_id = transaction.book_id
                               and category.id = transaction.category_id
                 where transaction.book_id = ? and category.kind = ?
                 group by transaction.category_id
                """, resultSet -> {
                    usage.put(
                            resultSet.getObject("category_id", UUID.class),
                            resultSet.getLong("transaction_count"));
                }, bookId, kind.name());
        return usage;
    }

    public RemapResult remapTransactions(
            UUID bookId,
            UUID sourceCategoryId,
            UUID fallbackCategoryId,
            UUID updatedByMemberId,
            Instant now
    ) {
        return jdbcTemplate.queryForObject("""
                with changed as (
                    update ledger_transaction
                       set category_id = ?, updated_by_member_id = ?, updated_at = ?,
                           version = version + 1
                     where book_id = ? and category_id = ?
                     returning occurred_on
                )
                select count(*) transaction_count,
                       min(occurred_on) first_occurred_on,
                       max(occurred_on) last_occurred_on
                  from changed
                """, (resultSet, rowNum) -> new RemapResult(
                resultSet.getLong("transaction_count"),
                resultSet.getObject("first_occurred_on", LocalDate.class),
                resultSet.getObject("last_occurred_on", LocalDate.class)),
                fallbackCategoryId, updatedByMemberId, Timestamp.from(now), bookId, sourceCategoryId);
    }

    public void insertArchiveAudit(
            UUID bookId,
            UUID actorMemberId,
            CategoryEntity archived,
            UUID fallbackCategoryId,
            RemapResult result,
            Instant now
    ) {
        jdbcTemplate.update("""
                insert into audit_log (
                    book_id, actor_type, actor_member_id, entity_type, entity_id, action,
                    entity_version, before_data, after_data, occurred_at
                ) values (
                    ?, 'USER', ?, 'CATEGORY', ?, 'ARCHIVE', ?,
                    jsonb_build_object('name', ?, 'kind', ?),
                    jsonb_build_object(
                        'fallbackCategoryId', ?,
                        'remappedTransactionCount', ?,
                        'firstOccurredOn', cast(? as date),
                        'lastOccurredOn', cast(? as date)
                    ), ?
                )
                """, bookId, actorMemberId, archived.getId(), archived.getVersion(),
                archived.getName(), archived.getKind().name(), fallbackCategoryId,
                result.transactionCount(), result.firstOccurredOn(), result.lastOccurredOn(),
                Timestamp.from(now));
    }

    public record RemapResult(long transactionCount, LocalDate firstOccurredOn, LocalDate lastOccurredOn) {
    }
}
