package com.dondok.settlement.infrastructure.persistence;

import com.dondok.common.id.UuidV7;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CardSettlementRepository {
    private final JdbcTemplate jdbcTemplate;

    public CardSettlementRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public CardAssetRow findCardAsset(UUID bookId, UUID assetId) {
        List<CardAssetRow> rows = jdbcTemplate.query("""
                select asset.id, type.behavior
                  from asset
                  join asset_type type on type.book_id = asset.book_id and type.id = asset.asset_type_id
                 where asset.book_id = ? and asset.id = ?
                """, (rs, rowNum) -> new CardAssetRow(
                rs.getObject("id", UUID.class), rs.getString("behavior")), bookId, assetId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public List<StatementRow> statementPage(
            UUID bookId,
            UUID cardAssetId,
            StatementCursor cursor,
            int limit,
            boolean includePaid
    ) {
        List<Object> arguments = new ArrayList<>();
        arguments.add(bookId);
        arguments.add(cardAssetId);
        String statusClause = includePaid
                ? "and statement.status in ('OPEN', 'FINALIZED', 'PAID')"
                : "and statement.status in ('OPEN', 'FINALIZED')";
        String cursorClause = "";
        if (cursor != null) {
            cursorClause = "and (statement.due_on, statement.id) < (?, ?)";
            arguments.add(Date.valueOf(cursor.dueOn()));
            arguments.add(cursor.statementId());
        }
        arguments.add(limit);
        return jdbcTemplate.query("""
                select statement.id, statement.book_id, statement.card_asset_id,
                       card.name card_asset_name, statement.due_on, statement.status,
                       forecast.gross_amount_won, forecast.paid_amount_won,
                       forecast.payment_amount_won, statement.version,
                       setting.settlement_asset_id, settlement.name settlement_asset_name,
                       coalesce(balance.current_balance_won, 0) settlement_asset_balance_won,
                       coalesce(setting.auto_settlement_enabled, false) auto_settlement_enabled,
                       schedule.id schedule_id, schedule.scheduled_on, schedule.status schedule_status,
                       schedule.attempt_count, schedule.next_retry_at
                  from card_statement statement
                  join card_statement_forecast forecast on forecast.statement_id = statement.id
                  join asset card on card.book_id = statement.book_id and card.id = statement.card_asset_id
                  left join card_setting setting
                    on setting.book_id = statement.book_id and setting.card_asset_id = statement.card_asset_id
                  left join asset settlement
                    on settlement.book_id = setting.book_id and settlement.id = setting.settlement_asset_id
                  left join asset_current_balance balance
                    on balance.book_id = setting.book_id and balance.asset_id = setting.settlement_asset_id
                  left join card_payment_schedule schedule
                    on schedule.book_id = statement.book_id and schedule.statement_id = statement.id
                 where statement.book_id = ? and statement.card_asset_id = ?
                """ + statusClause + " " + cursorClause + """
                 order by statement.due_on desc, statement.id desc
                 limit ?
                """, (rs, rowNum) -> statementRow(rs), arguments.toArray());
    }

    public StatementRow findStatement(UUID bookId, UUID statementId) {
        return statement(bookId, statementId);
    }

    public StatementRow lockStatement(UUID bookId, UUID statementId) {
        List<UUID> locked = jdbcTemplate.query("""
                select id from card_statement
                 where book_id = ? and id = ?
                 for update
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, statementId);
        return locked.isEmpty() ? null : statement(bookId, statementId);
    }

    public List<PaymentRow> payments(UUID bookId, UUID statementId) {
        return jdbcTemplate.query("""
                select payment.id, payment.statement_id, payment.payment_type, payment.settlement_asset_id,
                       asset.name settlement_asset_name, payment.amount_won,
                       coalesce(returned.amount_won, 0) returned_amount_won,
                       payment.paid_on, payment.settlement_transaction_id,
                       payment.created_by_member_id, payment.cancelled_at
                  from card_statement_payment payment
                  join asset on asset.book_id = payment.book_id and asset.id = payment.settlement_asset_id
                  left join lateral (
                      select sum(allocation.amount_won) amount_won
                        from card_purchase_refund_payment allocation
                       where allocation.statement_payment_id = payment.id
                  ) returned on true
                 where payment.book_id = ? and payment.statement_id = ?
                   and payment.cancelled_at is null
                 order by payment.paid_on desc, payment.id desc
                """, (rs, rowNum) -> new PaymentRow(
                rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getString("payment_type"),
                rs.getObject("settlement_asset_id", UUID.class), rs.getString("settlement_asset_name"),
                rs.getLong("amount_won"), rs.getLong("returned_amount_won"),
                rs.getObject("paid_on", LocalDate.class),
                rs.getObject("settlement_transaction_id", UUID.class),
                rs.getObject("created_by_member_id", UUID.class),
                rs.getTimestamp("cancelled_at") == null ? null : rs.getTimestamp("cancelled_at").toInstant()), bookId, statementId);
    }

    public PaymentRow findPayment(UUID bookId, UUID paymentId) {
        List<PaymentRow> rows = jdbcTemplate.query("""
                select payment.id, payment.statement_id, payment.payment_type, payment.settlement_asset_id,
                       asset.name settlement_asset_name, payment.amount_won,
                       coalesce(returned.amount_won, 0) returned_amount_won,
                       payment.paid_on, payment.settlement_transaction_id,
                       payment.created_by_member_id, payment.cancelled_at
                  from card_statement_payment payment
                  join asset on asset.book_id = payment.book_id and asset.id = payment.settlement_asset_id
                  left join lateral (
                      select sum(allocation.amount_won) amount_won
                        from card_purchase_refund_payment allocation
                       where allocation.statement_payment_id = payment.id
                  ) returned on true
                 where payment.book_id = ? and payment.id = ?
                """, (rs, rowNum) -> new PaymentRow(
                rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getString("payment_type"),
                rs.getObject("settlement_asset_id", UUID.class), rs.getString("settlement_asset_name"),
                rs.getLong("amount_won"), rs.getLong("returned_amount_won"),
                rs.getObject("paid_on", LocalDate.class),
                rs.getObject("settlement_transaction_id", UUID.class),
                rs.getObject("created_by_member_id", UUID.class),
                rs.getTimestamp("cancelled_at") == null ? null : rs.getTimestamp("cancelled_at").toInstant()), bookId, paymentId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public PaymentRow lockPayment(UUID bookId, UUID paymentId) {
        List<UUID> locked = jdbcTemplate.query("""
                select id from card_statement_payment
                 where book_id = ? and id = ?
                 for update
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, paymentId);
        return locked.isEmpty() ? null : findPayment(bookId, paymentId);
    }

    public boolean isActivePaymentSource(UUID bookId, UUID assetId) {
        Boolean exists = jdbcTemplate.queryForObject("""
                select exists(
                    select 1
                      from asset
                      join asset_type type
                        on type.book_id = asset.book_id and type.id = asset.asset_type_id
                     where asset.book_id = ? and asset.id = ?
                       and asset.archived_at is null and type.archived_at is null
                       and type.payment_source_capable
                )
                """, Boolean.class, bookId, assetId);
        return Boolean.TRUE.equals(exists);
    }

    public boolean isActiveAsset(UUID bookId, UUID assetId) {
        Boolean exists = jdbcTemplate.queryForObject("""
                select exists(
                    select 1 from asset
                     where book_id = ? and id = ? and archived_at is null
                )
                """, Boolean.class, bookId, assetId);
        return Boolean.TRUE.equals(exists);
    }

    public boolean activeRegularPaymentExists(UUID statementId) {
        Boolean exists = jdbcTemplate.queryForObject("""
                select exists(
                    select 1
                      from card_statement_payment payment
                      join ledger_transaction transaction
                        on transaction.book_id = payment.book_id
                       and transaction.id = payment.settlement_transaction_id
                     where payment.statement_id = ?
                       and payment.payment_type = 'REGULAR'
                       and payment.cancelled_at is null
                       and transaction.deleted_at is null
                )
                """, Boolean.class, statementId);
        return Boolean.TRUE.equals(exists);
    }

    public void cancelPrepayment(
            UUID bookId,
            UUID statementId,
            PaymentRow payment,
            UUID memberId,
            LocalDate today,
            boolean autoSettlementEnabled,
            Instant now
    ) {
        int paymentUpdated = jdbcTemplate.update("""
                update card_statement_payment
                   set cancelled_at = ?, cancelled_by_member_id = ?
                 where book_id = ? and id = ? and statement_id = ?
                   and payment_type = 'PREPAYMENT' and cancelled_at is null
                """, Timestamp.from(now), memberId, bookId, payment.paymentId(), statementId);
        int transactionUpdated = jdbcTemplate.update("""
                update ledger_transaction
                   set deleted_at = ?, deleted_by_member_id = ?,
                       updated_by_member_id = ?, updated_at = ?, version = version + 1
                 where book_id = ? and id = ? and deleted_at is null
                """, Timestamp.from(now), memberId, memberId, Timestamp.from(now),
                bookId, payment.settlementTransactionId());
        int statementUpdated = jdbcTemplate.update("""
                update card_statement statement
                   set status = case when statement.due_on > ? then 'OPEN' else 'FINALIZED' end,
                       finalized_at = case
                           when statement.due_on > ? then null
                           else coalesce(statement.finalized_at, ?)
                       end,
                       settled_at = null,
                       updated_at = ?, version = version + 1
                 where statement.book_id = ? and statement.id = ?
                """, Date.valueOf(today), Date.valueOf(today), Timestamp.from(now),
                Timestamp.from(now), bookId, statementId);
        if (autoSettlementEnabled) {
            jdbcTemplate.update("""
                    update card_payment_schedule
                       set status = 'SCHEDULED', last_error = null, next_retry_at = null,
                           updated_at = ?, version = version + 1
                     where book_id = ? and statement_id = ? and status = 'COMPLETED'
                    """, Timestamp.from(now), bookId, statementId);
        }
        if (paymentUpdated != 1 || transactionUpdated != 1 || statementUpdated != 1) {
            throw new IllegalStateException("card prepayment cancellation was incomplete");
        }
    }

    public void correctPaymentSettlementAsset(
            UUID bookId,
            UUID statementId,
            PaymentRow payment,
            UUID settlementAssetId,
            UUID editorMemberId,
            Instant now
    ) {
        int paymentUpdated = jdbcTemplate.update("""
                update card_statement_payment
                   set settlement_asset_id = ?
                 where book_id = ? and id = ? and statement_id = ? and settlement_asset_id = ?
                """, settlementAssetId, bookId, payment.paymentId(), statementId,
                payment.settlementAssetId());
        int postingUpdated = jdbcTemplate.update("""
                update transaction_posting
                   set asset_id = ?
                 where book_id = ? and transaction_id = ?
                   and asset_id = ? and delta_won = ?
                """, settlementAssetId, bookId, payment.settlementTransactionId(),
                payment.settlementAssetId(), -payment.amountWon());
        int transactionUpdated = jdbcTemplate.update("""
                update ledger_transaction
                   set updated_by_member_id = ?, updated_at = ?, version = version + 1
                 where book_id = ? and id = ? and deleted_at is null
                """, editorMemberId, Timestamp.from(now), bookId,
                payment.settlementTransactionId());
        if ("REGULAR".equals(payment.paymentType())) {
            jdbcTemplate.update("""
                    update card_payment_schedule
                       set settlement_asset_id = ?, updated_at = ?, version = version + 1
                     where book_id = ? and statement_id = ? and status = 'COMPLETED'
                    """, settlementAssetId, Timestamp.from(now), bookId, statementId);
        }
        int statementUpdated = jdbcTemplate.update("""
                update card_statement
                   set updated_at = ?, version = version + 1
                 where book_id = ? and id = ?
                """, Timestamp.from(now), bookId, statementId);
        if (paymentUpdated != 1 || postingUpdated != 1
                || transactionUpdated != 1 || statementUpdated != 1) {
            throw new IllegalStateException("card payment settlement asset correction was incomplete");
        }
    }

    public void insertPayment(PaymentWrite payment) {
        jdbcTemplate.update("""
                insert into card_statement_payment (
                    id, book_id, statement_id, payment_type, settlement_asset_id,
                    amount_won, paid_on, settlement_transaction_id, created_by_member_id, created_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, payment.paymentId(), payment.bookId(), payment.statementId(), payment.paymentType(),
                payment.settlementAssetId(), payment.amountWon(), Date.valueOf(payment.paidOn()),
                payment.settlementTransactionId(), payment.createdByMemberId(), Timestamp.from(payment.now()));
    }

    public void recordPrepayment(UUID statementId, boolean fullyPaid, Instant now) {
        if (!fullyPaid) {
            jdbcTemplate.update("""
                    update card_statement
                       set updated_at = ?, version = version + 1
                     where id = ?
                    """, Timestamp.from(now), statementId);
            return;
        }
        jdbcTemplate.update("""
                update card_statement statement
                   set status = 'PAID',
                       billed_amount_won = coalesce((
                           select sum(charge.principal_amount_won)
                             from card_charge charge
                             join ledger_transaction purchase
                               on purchase.book_id = charge.book_id
                              and purchase.id = charge.source_transaction_id
                              and purchase.deleted_at is null
                            where charge.statement_id = statement.id
                              and not charge.absorbed_by_balance_anchor
                       ), 0),
                       finalized_at = coalesce(finalized_at, ?), settled_at = ?,
                       updated_at = ?, version = version + 1
                 where statement.id = ?
                """, Timestamp.from(now), Timestamp.from(now), Timestamp.from(now), statementId);
        jdbcTemplate.update("""
                update card_payment_schedule
                   set status = 'COMPLETED', last_error = null, next_retry_at = null,
                       updated_at = ?, version = version + 1
                 where statement_id = ? and status in ('SCHEDULED', 'PROCESSING', 'FAILED')
                """, Timestamp.from(now), statementId);
    }

    public List<UUID> dueScheduleIds(LocalDate today, Instant now, int limit) {
        return jdbcTemplate.query("""
                select schedule.id
                  from card_payment_schedule schedule
                  join card_statement statement
                    on statement.book_id = schedule.book_id
                   and statement.id = schedule.statement_id
                  join asset card
                    on card.book_id = statement.book_id
                   and card.id = statement.card_asset_id
                   and card.archived_at is null
                 where schedule.scheduled_on <= ?
                   and (
                       schedule.status = 'SCHEDULED'
                       or (schedule.status = 'FAILED'
                           and (schedule.next_retry_at is null or schedule.next_retry_at <= ?))
                   )
                 order by schedule.scheduled_on, schedule.id
                 limit ?
                """, (rs, rowNum) -> rs.getObject(1, UUID.class),
                Date.valueOf(today), Timestamp.from(now), limit);
    }

    public UUID findScheduleBookId(UUID scheduleId) {
        List<UUID> bookIds = jdbcTemplate.query(
                "select book_id from card_payment_schedule where id = ?",
                (rs, rowNum) -> rs.getObject(1, UUID.class),
                scheduleId);
        return bookIds.isEmpty() ? null : bookIds.get(0);
    }

    public ScheduleRow lockSchedule(UUID scheduleId) {
        List<ScheduleRow> rows = jdbcTemplate.query("""
                select schedule.id, schedule.book_id, schedule.statement_id,
                       schedule.settlement_asset_id, schedule.scheduled_on, schedule.status,
                       schedule.attempt_count, schedule.next_retry_at
                  from card_payment_schedule schedule
                 where schedule.id = ?
                 for update
                """, (rs, rowNum) -> new ScheduleRow(
                rs.getObject("id", UUID.class), rs.getObject("book_id", UUID.class),
                rs.getObject("statement_id", UUID.class),
                rs.getObject("settlement_asset_id", UUID.class),
                rs.getObject("scheduled_on", LocalDate.class), rs.getString("status"),
                rs.getInt("attempt_count"),
                rs.getTimestamp("next_retry_at") == null ? null
                        : rs.getTimestamp("next_retry_at").toInstant()), scheduleId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public boolean regularPaymentExists(UUID statementId) {
        Boolean exists = jdbcTemplate.queryForObject("""
                select exists(
                    select 1 from card_statement_payment
                     where statement_id = ? and payment_type = 'REGULAR'
                )
                """, Boolean.class, statementId);
        return Boolean.TRUE.equals(exists);
    }

    public void completeRegularSettlement(UUID statementId, UUID scheduleId, Instant now) {
        jdbcTemplate.update("""
                update card_statement statement
                   set status = 'PAID',
                       billed_amount_won = coalesce((
                           select sum(charge.principal_amount_won)
                             from card_charge charge
                             join ledger_transaction purchase
                               on purchase.book_id = charge.book_id
                              and purchase.id = charge.source_transaction_id
                              and purchase.deleted_at is null
                            where charge.statement_id = statement.id
                              and not charge.absorbed_by_balance_anchor
                       ), 0),
                       finalized_at = coalesce(finalized_at, ?), settled_at = ?,
                       updated_at = ?, version = version + 1
                 where statement.id = ?
                """, Timestamp.from(now), Timestamp.from(now), Timestamp.from(now), statementId);
        completeSchedule(scheduleId, now);
    }

    public void completeSchedule(UUID scheduleId, Instant now) {
        jdbcTemplate.update("""
                update card_payment_schedule
                   set status = 'COMPLETED', last_error = null, next_retry_at = null,
                       updated_at = ?, version = version + 1
                 where id = ?
                """, Timestamp.from(now), scheduleId);
    }

    public void cancelSchedule(UUID scheduleId, Instant now) {
        jdbcTemplate.update("""
                update card_payment_schedule
                   set status = 'CANCELLED', last_error = null, next_retry_at = null,
                       updated_at = ?, version = version + 1
                 where id = ?
                """, Timestamp.from(now), scheduleId);
    }

    public void updateScheduleSettlementAsset(UUID scheduleId, UUID settlementAssetId, Instant now) {
        jdbcTemplate.update("""
                update card_payment_schedule
                   set settlement_asset_id = ?, updated_at = ?, version = version + 1
                 where id = ?
                """, settlementAssetId, Timestamp.from(now), scheduleId);
    }

    public void recordScheduleFailure(UUID scheduleId, String error, Instant nextRetryAt, Instant now) {
        jdbcTemplate.update("""
                update card_payment_schedule
                   set status = 'FAILED', attempt_count = attempt_count + 1,
                       last_error = ?, next_retry_at = ?, updated_at = ?, version = version + 1
                 where id = ? and status not in ('COMPLETED', 'CANCELLED')
                """, error, Timestamp.from(nextRetryAt), Timestamp.from(now), scheduleId);
    }

    private StatementRow statement(UUID bookId, UUID statementId) {
        List<StatementRow> rows = jdbcTemplate.query("""
                select statement.id, statement.book_id, statement.card_asset_id,
                       card.name card_asset_name, statement.due_on, statement.status,
                       forecast.gross_amount_won, forecast.paid_amount_won,
                       forecast.payment_amount_won, statement.version,
                       setting.settlement_asset_id, settlement.name settlement_asset_name,
                       coalesce(balance.current_balance_won, 0) settlement_asset_balance_won,
                       coalesce(setting.auto_settlement_enabled, false) auto_settlement_enabled,
                       schedule.id schedule_id, schedule.scheduled_on, schedule.status schedule_status,
                       schedule.attempt_count, schedule.next_retry_at
                  from card_statement statement
                  join card_statement_forecast forecast on forecast.statement_id = statement.id
                  join asset card on card.book_id = statement.book_id and card.id = statement.card_asset_id
                  left join card_setting setting
                    on setting.book_id = statement.book_id and setting.card_asset_id = statement.card_asset_id
                  left join asset settlement
                    on settlement.book_id = setting.book_id and settlement.id = setting.settlement_asset_id
                  left join asset_current_balance balance
                    on balance.book_id = setting.book_id and balance.asset_id = setting.settlement_asset_id
                  left join card_payment_schedule schedule
                    on schedule.book_id = statement.book_id and schedule.statement_id = statement.id
                 where statement.book_id = ? and statement.id = ?
                """, (rs, rowNum) -> statementRow(rs), bookId, statementId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private StatementRow statementRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        UUID settlementAssetId = optionalUuid(rs, "settlement_asset_id");
        UUID scheduleId = optionalUuid(rs, "schedule_id");
        return new StatementRow(
                rs.getObject("id", UUID.class), rs.getObject("book_id", UUID.class),
                rs.getObject("card_asset_id", UUID.class), rs.getString("card_asset_name"),
                rs.getObject("due_on", LocalDate.class), rs.getString("status"),
                rs.getLong("gross_amount_won"), rs.getLong("paid_amount_won"),
                rs.getLong("payment_amount_won"), rs.getLong("version"),
                settlementAssetId, settlementAssetId == null ? null : rs.getString("settlement_asset_name"),
                settlementAssetId == null ? 0 : rs.getLong("settlement_asset_balance_won"),
                rs.getBoolean("auto_settlement_enabled"),
                scheduleId, scheduleId == null ? null : rs.getObject("scheduled_on", LocalDate.class),
                scheduleId == null ? null : rs.getString("schedule_status"),
                scheduleId == null ? 0 : rs.getInt("attempt_count"),
                scheduleId == null || rs.getTimestamp("next_retry_at") == null ? null
                        : rs.getTimestamp("next_retry_at").toInstant());
    }

    private UUID optionalUuid(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        return rs.getObject(column, UUID.class);
    }

    public record CardAssetRow(UUID assetId, String behavior) {
    }

    public record StatementCursor(LocalDate dueOn, UUID statementId) {
    }

    public record StatementRow(
            UUID statementId,
            UUID bookId,
            UUID cardAssetId,
            String cardAssetName,
            LocalDate dueOn,
            String status,
            long grossAmountWon,
            long paidAmountWon,
            long remainingAmountWon,
            long version,
            UUID settlementAssetId,
            String settlementAssetName,
            long settlementAssetBalanceWon,
            boolean autoSettlementEnabled,
            UUID scheduleId,
            LocalDate scheduledOn,
            String scheduleStatus,
            int attemptCount,
            Instant nextRetryAt
    ) {
    }

    public record PaymentRow(
            UUID paymentId,
            UUID statementId,
            String paymentType,
            UUID settlementAssetId,
            String settlementAssetName,
            long amountWon,
            long returnedAmountWon,
            LocalDate paidOn,
            UUID settlementTransactionId,
            UUID createdByMemberId,
            Instant cancelledAt
    ) {
    }

    public record PaymentWrite(
            UUID paymentId,
            UUID bookId,
            UUID statementId,
            String paymentType,
            UUID settlementAssetId,
            long amountWon,
            LocalDate paidOn,
            UUID settlementTransactionId,
            UUID createdByMemberId,
            Instant now
    ) {
    }

    public record ScheduleRow(
            UUID scheduleId,
            UUID bookId,
            UUID statementId,
            UUID settlementAssetId,
            LocalDate scheduledOn,
            String status,
            int attemptCount,
            Instant nextRetryAt
    ) {
    }
}
