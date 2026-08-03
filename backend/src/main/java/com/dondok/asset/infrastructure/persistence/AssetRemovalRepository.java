package com.dondok.asset.infrastructure.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.StringJoiner;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AssetRemovalRepository {
    private final JdbcTemplate jdbcTemplate;

    public AssetRemovalRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public RemovalSnapshot snapshot(UUID bookId, UUID assetId) {
        long currentBalanceWon = nullableLong(jdbcTemplate.queryForObject("""
                select current_balance_won
                  from asset_current_balance
                 where book_id = ? and asset_id = ?
                """, Long.class, bookId, assetId));
        List<HistoryState> history = history(bookId, assetId);
        List<UnpaidStatementState> unpaidStatements = unpaidStatements(bookId, assetId);
        List<LinkState> links = links(bookId, assetId);
        List<String> lifecycleReferences = lifecycleReferences(bookId, assetId);
        return new RemovalSnapshot(
                currentBalanceWon, history, unpaidStatements, links, lifecycleReferences);
    }

    public void lockRemovalState(UUID bookId, UUID assetId) {
        jdbcTemplate.queryForList("""
                select transaction.id
                  from ledger_transaction transaction
                 where transaction.book_id = ?
                   and (
                       transaction.primary_asset_id = ?
                       or exists (
                           select 1
                             from transaction_posting posting
                            where posting.book_id = transaction.book_id
                              and posting.transaction_id = transaction.id
                              and posting.asset_id = ?
                       )
                   )
                 order by transaction.id
                   for share
                """, UUID.class, bookId, assetId, assetId);
        jdbcTemplate.queryForList("""
                select statement.id
                  from card_statement statement
                 where statement.book_id = ?
                   and statement.card_asset_id = ?
                   and statement.status in ('OPEN', 'FINALIZED')
                 order by statement.id
                   for share
                """, UUID.class, bookId, assetId);
        jdbcTemplate.queryForList("""
                select schedule.id
                  from card_payment_schedule schedule
                 where schedule.book_id = ?
                   and schedule.settlement_asset_id = ?
                   and schedule.status in ('SCHEDULED', 'PROCESSING', 'FAILED')
                 order by schedule.id
                   for share
                """, UUID.class, bookId, assetId);
    }

    private List<HistoryState> history(UUID bookId, UUID assetId) {
        return jdbcTemplate.query("""
                select transaction.id,
                       transaction.version,
                       transaction.deleted_at,
                       (transaction.primary_asset_id = ?) as primary_asset,
                       min(posting.line_no)
                           filter (where posting.asset_id = ?) as target_line_no,
                       coalesce(sum(posting.delta_won)
                           filter (where posting.asset_id = ?), 0) as target_delta_won
                  from ledger_transaction transaction
                  left join transaction_posting posting
                    on posting.book_id = transaction.book_id
                   and posting.transaction_id = transaction.id
                 where transaction.book_id = ?
                   and (
                       transaction.primary_asset_id = ?
                       or exists (
                           select 1
                             from transaction_posting target_posting
                            where target_posting.book_id = transaction.book_id
                              and target_posting.transaction_id = transaction.id
                              and target_posting.asset_id = ?
                       )
                   )
                 group by transaction.id, transaction.version, transaction.deleted_at,
                          transaction.primary_asset_id
                 order by transaction.id
                """, (rs, rowNum) -> new HistoryState(
                        rs.getObject("id", UUID.class),
                        rs.getLong("version"),
                        toInstant(rs.getTimestamp("deleted_at")),
                        rs.getBoolean("primary_asset"),
                        rs.getObject("target_line_no", Integer.class),
                        rs.getLong("target_delta_won")),
                assetId, assetId, assetId, bookId, assetId, assetId);
    }

    private List<UnpaidStatementState> unpaidStatements(UUID bookId, UUID assetId) {
        return jdbcTemplate.query("""
                select statement.id,
                       statement.version,
                       statement.status,
                       statement.due_on,
                       forecast.payment_amount_won,
                       schedule.id as schedule_id,
                       schedule.status as schedule_status,
                       schedule.version as schedule_version,
                       schedule.settlement_asset_id
                  from card_statement statement
                  join card_statement_forecast forecast
                    on forecast.book_id = statement.book_id
                   and forecast.statement_id = statement.id
                  left join card_payment_schedule schedule
                    on schedule.book_id = statement.book_id
                   and schedule.statement_id = statement.id
                 where statement.book_id = ?
                   and statement.card_asset_id = ?
                   and statement.status in ('OPEN', 'FINALIZED')
                   and forecast.payment_amount_won > 0
                 order by statement.id
                """, (rs, rowNum) -> new UnpaidStatementState(
                        rs.getObject("id", UUID.class),
                        rs.getLong("version"),
                        rs.getString("status"),
                        rs.getObject("due_on", LocalDate.class),
                        rs.getLong("payment_amount_won"),
                        rs.getObject("schedule_id", UUID.class),
                        rs.getString("schedule_status"),
                        nullableLong(rs.getObject("schedule_version", Long.class)),
                        rs.getObject("settlement_asset_id", UUID.class)),
                bookId, assetId);
    }

    private List<LinkState> links(UUID bookId, UUID assetId) {
        List<LinkState> links = new ArrayList<>();
        links.addAll(jdbcTemplate.query("""
                select card.id as asset_id,
                       card.name as asset_name,
                       card.archived_at,
                       setting.version as setting_version,
                       card.version as asset_version,
                       setting.auto_settlement_enabled,
                       exists (
                           select 1
                             from card_statement_forecast forecast
                            where forecast.book_id = setting.book_id
                              and forecast.card_asset_id = setting.card_asset_id
                              and forecast.status in ('OPEN', 'FINALIZED')
                              and forecast.payment_amount_won > 0
                       ) as has_unpaid_statement
                  from card_setting setting
                  join asset card
                    on card.book_id = setting.book_id
                   and card.id = setting.card_asset_id
                 where setting.book_id = ? and setting.settlement_asset_id = ?
                 order by card.id
                """, (rs, rowNum) -> new LinkState(
                        "CREDIT_CARD_SETTLEMENT",
                        rs.getObject("asset_id", UUID.class),
                        rs.getString("asset_name"),
                        rs.getTimestamp("archived_at") == null || rs.getBoolean("has_unpaid_statement"),
                        rs.getLong("setting_version") + ":" + rs.getLong("asset_version") + ":"
                                + rs.getBoolean("auto_settlement_enabled")
                                + ":" + rs.getBoolean("has_unpaid_statement") + ":"
                                + instantText(toInstant(rs.getTimestamp("archived_at")))),
                bookId, assetId));
        links.addAll(jdbcTemplate.query("""
                select debit_card.id as asset_id,
                       debit_card.name as asset_name,
                       debit_card.archived_at,
                       setting.version as setting_version,
                       debit_card.version as asset_version
                  from debit_card_setting setting
                  join asset debit_card
                    on debit_card.book_id = setting.book_id
                   and debit_card.id = setting.debit_card_asset_id
                 where setting.book_id = ? and setting.payment_asset_id = ?
                 order by debit_card.id
                """, (rs, rowNum) -> new LinkState(
                        "DEBIT_CARD_PAYMENT",
                        rs.getObject("asset_id", UUID.class),
                        rs.getString("asset_name"),
                        rs.getTimestamp("archived_at") == null,
                        rs.getLong("setting_version") + ":" + rs.getLong("asset_version") + ":"
                                + instantText(toInstant(rs.getTimestamp("archived_at")))),
                bookId, assetId));
        links.addAll(jdbcTemplate.query("""
                select savings.id as asset_id,
                       savings.name as asset_name,
                       savings.archived_at,
                       setting.version as setting_version,
                       savings.version as asset_version
                  from savings_setting setting
                  join asset savings
                    on savings.book_id = setting.book_id
                   and savings.id = setting.savings_asset_id
                 where setting.book_id = ? and setting.transfer_asset_id = ?
                 order by savings.id
                """, (rs, rowNum) -> new LinkState(
                        "SAVINGS_TRANSFER",
                        rs.getObject("asset_id", UUID.class),
                        rs.getString("asset_name"),
                        rs.getTimestamp("archived_at") == null,
                        rs.getLong("setting_version") + ":" + rs.getLong("asset_version") + ":"
                                + instantText(toInstant(rs.getTimestamp("archived_at")))),
                bookId, assetId));
        links.addAll(jdbcTemplate.query("""
                select schedule.id,
                       schedule.version,
                       schedule.status,
                       schedule.scheduled_on,
                       card.id as asset_id,
                       card.name as asset_name,
                       card.version as asset_version
                  from card_payment_schedule schedule
                  join card_statement statement
                    on statement.book_id = schedule.book_id
                   and statement.id = schedule.statement_id
                  join asset card
                    on card.book_id = statement.book_id
                   and card.id = statement.card_asset_id
                 where schedule.book_id = ?
                   and schedule.settlement_asset_id = ?
                   and schedule.status in ('SCHEDULED', 'PROCESSING', 'FAILED')
                 order by schedule.id
                """, (rs, rowNum) -> new LinkState(
                        "CARD_PAYMENT_SCHEDULE",
                        rs.getObject("asset_id", UUID.class),
                        rs.getString("asset_name"),
                        true,
                        rs.getObject("id", UUID.class) + ":" + rs.getLong("version") + ":"
                                + rs.getLong("asset_version") + ":"
                                + rs.getString("status") + ":" + rs.getObject("scheduled_on", LocalDate.class)),
                bookId, assetId));
        links.sort(java.util.Comparator.comparing(LinkState::kind)
                .thenComparing(state -> state.assetId().toString())
                .thenComparing(LinkState::state));
        return List.copyOf(links);
    }

    private List<String> lifecycleReferences(UUID bookId, UUID assetId) {
        return jdbcTemplate.query("""
                select reference_kind, reference_id, reference_state
                  from (
                    select 'CARD_STATEMENT' as reference_kind,
                           statement.id as reference_id,
                           statement.version::text || ':' || statement.status as reference_state
                      from card_statement statement
                     where statement.book_id = ? and statement.card_asset_id = ?
                    union all
                    select 'CARD_CHARGE', charge.id,
                           charge.principal_amount_won::text || ':' || charge.expected_settlement_on::text
                      from card_charge charge
                     where charge.book_id = ? and charge.card_asset_id = ?
                    union all
                    select 'CARD_BILLING_SNAPSHOT', snapshot.purchase_transaction_id,
                           snapshot.installment_count::text || ':' || snapshot.updated_at::text
                      from card_purchase_billing_snapshot snapshot
                     where snapshot.book_id = ? and snapshot.card_asset_id = ?
                    union all
                    select 'CARD_PAYMENT_SCHEDULE', schedule.id,
                           schedule.version::text || ':' || schedule.status
                      from card_payment_schedule schedule
                     where schedule.book_id = ? and schedule.settlement_asset_id = ?
                    union all
                    select 'CARD_STATEMENT_PAYMENT', payment.id,
                           payment.amount_won::text || ':' || payment.settlement_transaction_id::text
                      from card_statement_payment payment
                     where payment.book_id = ? and payment.settlement_asset_id = ?
                  ) reference
                 order by reference_kind, reference_id
                """, (rs, rowNum) -> rs.getString("reference_kind") + ":"
                        + rs.getObject("reference_id", UUID.class) + ":"
                        + rs.getString("reference_state"),
                bookId, assetId, bookId, assetId, bookId, assetId,
                bookId, assetId, bookId, assetId);
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static long nullableLong(Long value) {
        return value == null ? 0 : value;
    }

    private static String instantText(Instant value) {
        return value == null ? "-" : value.toString();
    }

    public record RemovalSnapshot(
            long currentBalanceWon,
            List<HistoryState> history,
            List<UnpaidStatementState> unpaidStatements,
            List<LinkState> links,
            List<String> lifecycleReferences
    ) {
        public long historyTransactionCount() {
            return history.size();
        }

        public boolean requiresArchive() {
            return !history.isEmpty() || !lifecycleReferences.isEmpty()
                    || links.stream().anyMatch(link -> !link.blocking());
        }

        public List<LinkState> blockingLinks() {
            return links.stream().filter(LinkState::blocking).toList();
        }

        public String canonicalState() {
            StringJoiner state = new StringJoiner("|");
            state.add("balance:" + currentBalanceWon);
            history.forEach(row -> state.add("history:" + row.canonicalState()));
            unpaidStatements.forEach(row -> state.add("unpaid:" + row.canonicalState()));
            links.forEach(row -> state.add("link:" + row.canonicalState()));
            lifecycleReferences.forEach(row -> state.add("lifecycle:" + row));
            return state.toString();
        }
    }

    public record HistoryState(
            UUID transactionId,
            long version,
            Instant deletedAt,
            boolean primaryAsset,
            Integer targetLineNo,
            long targetDeltaWon
    ) {
        String canonicalState() {
            return transactionId + ":" + version + ":" + instantText(deletedAt) + ":"
                    + primaryAsset + ":" + targetLineNo + ":" + targetDeltaWon;
        }
    }

    public record UnpaidStatementState(
            UUID statementId,
            long version,
            String status,
            LocalDate dueOn,
            long paymentAmountWon,
            UUID scheduleId,
            String scheduleStatus,
            long scheduleVersion,
            UUID settlementAssetId
    ) {
        String canonicalState() {
            return statementId + ":" + version + ":" + status + ":" + dueOn + ":"
                    + paymentAmountWon + ":" + scheduleId + ":" + scheduleStatus + ":"
                    + scheduleVersion + ":" + settlementAssetId;
        }
    }

    public record LinkState(String kind, UUID assetId, String assetName, boolean blocking, String state) {
        String canonicalState() {
            return kind + ":" + assetId + ":" + assetName + ":" + blocking + ":" + state;
        }
    }
}
