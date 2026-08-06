package com.dondok.asset.infrastructure.persistence;

import com.dondok.asset.domain.CardBillingCyclePolicy;
import com.dondok.common.id.UuidV7;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;

@Repository
public class AssetLedgerRepository {
    private final JdbcTemplate jdbcTemplate;

    public AssetLedgerRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<UUID, Long> currentBalances(UUID bookId) {
        Map<UUID, Long> balances = new HashMap<>();
        jdbcTemplate.query(
                "select asset_id, current_balance_won from asset_current_balance where book_id = ?",
                (RowCallbackHandler) rs -> balances.put(
                        rs.getObject("asset_id", UUID.class), rs.getLong("current_balance_won")),
                bookId);
        return balances;
    }

    public long currentBalance(UUID bookId, UUID assetId) {
        Long balance = jdbcTemplate.queryForObject(
                "select current_balance_won from asset_current_balance where book_id = ? and asset_id = ?",
                Long.class, bookId, assetId);
        return balance == null ? 0 : balance;
    }

    public Map<UUID, Long> openingBalances(UUID bookId, List<UUID> assetIds) {
        Map<UUID, Long> balances = new HashMap<>();
        if (assetIds.isEmpty()) {
            return balances;
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(assetIds.size(), "?"));
        Object[] parameters = new Object[assetIds.size() + 1];
        parameters[0] = bookId;
        for (int index = 0; index < assetIds.size(); index++) {
            parameters[index + 1] = assetIds.get(index);
        }
        jdbcTemplate.query("""
                select id as asset_id, balance_anchor_won as opening_balance_won
                  from asset
                 where book_id = ? and id in (%s)
                """.formatted(placeholders),
                (RowCallbackHandler) rs -> balances.put(
                        rs.getObject("asset_id", UUID.class), rs.getLong("opening_balance_won")),
                parameters);
        return balances;
    }

    public long openingBalance(UUID bookId, UUID assetId) {
        Long balance = jdbcTemplate.queryForObject("""
                select balance_anchor_won
                  from asset
                 where book_id = ? and id = ?
                """, Long.class, bookId, assetId);
        return balance == null ? 0 : balance;
    }

    public Map<UUID, CardPaymentDues> cardPaymentDues(
            UUID bookId,
            List<UUID> cardAssetIds,
            LocalDate monthStart,
            LocalDate nextMonthStart,
            LocalDate afterNextMonthStart
    ) {
        Map<UUID, CardPaymentDues> paymentDues = new HashMap<>();
        if (cardAssetIds.isEmpty()) {
            return paymentDues;
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(cardAssetIds.size(), "?"));
        Object[] parameters = new Object[cardAssetIds.size() + 4];
        parameters[0] = Date.valueOf(nextMonthStart);
        parameters[1] = bookId;
        for (int index = 0; index < cardAssetIds.size(); index++) {
            parameters[index + 2] = cardAssetIds.get(index);
        }
        parameters[cardAssetIds.size() + 2] = Date.valueOf(monthStart);
        parameters[cardAssetIds.size() + 3] = Date.valueOf(afterNextMonthStart);
        jdbcTemplate.query("""
                select forecast.card_asset_id,
                       coalesce(sum(forecast.payment_amount_won)
                           filter (where forecast.due_on < boundary.next_month_start), 0)
                           as current_month_payment_due_won,
                       coalesce(sum(forecast.payment_amount_won)
                           filter (where forecast.due_on >= boundary.next_month_start), 0)
                           as next_month_payment_due_won
                  from card_statement_forecast forecast
                 cross join (values (?::date)) boundary(next_month_start)
                 where forecast.book_id = ?
                   and forecast.card_asset_id in (%s)
                   and forecast.status in ('OPEN', 'FINALIZED')
                   and forecast.due_on >= ?
                   and forecast.due_on < ?
                 group by forecast.card_asset_id
                """.formatted(placeholders),
                (RowCallbackHandler) rs -> paymentDues.put(
                        rs.getObject("card_asset_id", UUID.class),
                        new CardPaymentDues(
                                rs.getLong("current_month_payment_due_won"),
                                rs.getLong("next_month_payment_due_won"))),
                parameters);
        return paymentDues;
    }

    public record CardPaymentDues(long currentMonthWon, long nextMonthWon) {
    }

    public UUID synchronizeOpeningBalance(
            UUID bookId, UUID assetId, UUID memberId, LocalDate openedOn,
            long openingBalanceWon, Instant now
    ) {
        Optional<UUID> existing = openingTransactionId(bookId, assetId);
        if (openingBalanceWon == 0) {
            existing.ifPresent(transactionId -> {
                removeCardOpening(transactionId, now);
                jdbcTemplate.update("delete from ledger_transaction where id = ?", transactionId);
            });
            return null;
        }

        if (existing.isPresent()) {
            UUID transactionId = existing.get();
            jdbcTemplate.update("""
                    update ledger_transaction
                       set occurred_on = ?, amount_won = ?, updated_by_member_id = ?,
                           updated_at = ?, version = version + 1
                     where id = ? and book_id = ?
                    """, Date.valueOf(openedOn), absolute(openingBalanceWon), memberId,
                    Timestamp.from(now), transactionId, bookId);
            jdbcTemplate.update("""
                    update transaction_posting set delta_won = ?
                     where transaction_id = ? and line_no = 1 and book_id = ? and asset_id = ?
                    """, openingBalanceWon, transactionId, bookId, assetId);
            return transactionId;
        }

        UUID transactionId = UuidV7.next();
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, occurred_on, amount_won, description,
                    source_type, source_id, created_by_member_id, updated_by_member_id,
                    created_at, updated_at, version
                ) values (?, ?, 'ADJUSTMENT', ?, ?, '최초 잔액', 'OPENING_BALANCE', ?, ?, ?, ?, ?, 0)
                """, transactionId, bookId, Date.valueOf(openedOn), absolute(openingBalanceWon),
                assetId, memberId, memberId, Timestamp.from(now), Timestamp.from(now));
        jdbcTemplate.update("""
                insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
                values (?, 1, ?, ?, ?)
                """, transactionId, bookId, assetId, openingBalanceWon);
        return transactionId;
    }

    public void synchronizeCardOpening(
            UUID bookId,
            UUID assetId,
            UUID openingTransactionId,
            long openingBalanceWon,
            CardSettingEntity setting,
            CardBillingCyclePolicy.Cycle cycle,
            Instant now
    ) {
        if (openingTransactionId != null) {
            removeCardOpening(openingTransactionId, now);
        }
        if (openingTransactionId == null || openingBalanceWon >= 0 || setting == null) {
            return;
        }

        UUID statementId = findStatement(assetId, cycle.start(), cycle.end()).orElseGet(() -> {
            UUID id = UuidV7.next();
            jdbcTemplate.update("""
                    insert into card_statement (
                        id, book_id, card_asset_id, cycle_start, cycle_end, due_on,
                        status, billed_amount_won, created_at, updated_at, version
                    ) values (?, ?, ?, ?, ?, ?, 'OPEN', 0, ?, ?, 0)
                    """, id, bookId, assetId, Date.valueOf(cycle.start()), Date.valueOf(cycle.end()),
                    Date.valueOf(cycle.dueOn()), Timestamp.from(now), Timestamp.from(now));
            return id;
        });
        LocalDate expectedOn = jdbcTemplate.queryForObject(
                "select due_on from card_statement where id = ?", LocalDate.class, statementId);
        jdbcTemplate.update("""
                insert into card_charge (
                    id, book_id, source_transaction_id, card_asset_id, statement_id,
                    charge_origin, installment_no, installment_count, principal_amount_won,
                    expected_settlement_on, created_at
                ) values (?, ?, ?, ?, ?, 'OPENING_BALANCE', 1, 1, ?, ?, ?)
                """, UuidV7.next(), bookId, openingTransactionId, assetId, statementId,
                absolute(openingBalanceWon), Date.valueOf(expectedOn), Timestamp.from(now));
        recalculateBilledAmount(statementId, now);

        if (setting.isAutoSettlementEnabled() && setting.getSettlementAssetId() != null) {
            jdbcTemplate.update("""
                    insert into card_payment_schedule (
                        id, book_id, statement_id, settlement_asset_id, scheduled_on,
                        status, attempt_count, created_at, updated_at, version
                    ) values (?, ?, ?, ?, ?, 'SCHEDULED', 0, ?, ?, 0)
                    on conflict (statement_id) do update
                       set settlement_asset_id = excluded.settlement_asset_id,
                           scheduled_on = excluded.scheduled_on,
                           updated_at = excluded.updated_at,
                           version = card_payment_schedule.version + 1
                    """, UuidV7.next(), bookId, statementId, setting.getSettlementAssetId(),
                    Date.valueOf(expectedOn), Timestamp.from(now), Timestamp.from(now));
        }
    }

    public boolean isPublicHoliday(LocalDate date) {
        Boolean exists = jdbcTemplate.queryForObject(
                "select exists(select 1 from korean_public_holiday where holiday_on = ?)",
                Boolean.class, Date.valueOf(date));
        return Boolean.TRUE.equals(exists);
    }

    public void synchronizeCardPaymentSchedules(
            UUID bookId,
            UUID cardAssetId,
            CardSettingEntity setting,
            Instant now
    ) {
        if (setting == null || !setting.isAutoSettlementEnabled()
                || setting.getSettlementAssetId() == null) {
            jdbcTemplate.update("""
                    update card_payment_schedule schedule
                       set status = 'CANCELLED', last_error = null, next_retry_at = null,
                           updated_at = ?, version = schedule.version + 1
                      from card_statement statement
                     where schedule.book_id = ?
                       and schedule.statement_id = statement.id
                       and statement.card_asset_id = ?
                       and schedule.status in ('SCHEDULED', 'PROCESSING', 'FAILED')
                    """, Timestamp.from(now), bookId, cardAssetId);
            return;
        }

        List<ScheduleTarget> targets = jdbcTemplate.query("""
                select statement.id, statement.due_on
                  from card_statement statement
                  join card_statement_forecast forecast on forecast.statement_id = statement.id
                 where statement.book_id = ? and statement.card_asset_id = ?
                   and statement.status in ('OPEN', 'FINALIZED')
                   and forecast.payment_amount_won > 0
                   and not exists (
                       select 1 from card_statement_payment payment
                        where payment.statement_id = statement.id
                          and payment.payment_type = 'REGULAR'
                   )
                 order by statement.id
                """, (rs, rowNum) -> new ScheduleTarget(
                rs.getObject("id", UUID.class), rs.getObject("due_on", LocalDate.class)),
                bookId, cardAssetId);
        for (ScheduleTarget target : targets) {
            jdbcTemplate.update("""
                    insert into card_payment_schedule (
                        id, book_id, statement_id, settlement_asset_id, scheduled_on,
                        status, attempt_count, created_at, updated_at, version
                    ) values (?, ?, ?, ?, ?, 'SCHEDULED', 0, ?, ?, 0)
                    on conflict (statement_id) do update
                       set settlement_asset_id = excluded.settlement_asset_id,
                           scheduled_on = excluded.scheduled_on,
                           status = 'SCHEDULED', attempt_count = 0,
                           last_error = null, next_retry_at = null,
                           updated_at = excluded.updated_at,
                           version = card_payment_schedule.version + 1
                    """, UuidV7.next(), bookId, target.statementId(), setting.getSettlementAssetId(),
                    Date.valueOf(target.dueOn()), Timestamp.from(now), Timestamp.from(now));
        }

        jdbcTemplate.update("""
                update card_payment_schedule schedule
                   set status = 'CANCELLED', last_error = null, next_retry_at = null,
                       updated_at = ?, version = schedule.version + 1
                  from card_statement statement
                 where schedule.book_id = ?
                   and schedule.statement_id = statement.id
                   and statement.card_asset_id = ?
                   and schedule.status in ('SCHEDULED', 'PROCESSING', 'FAILED')
                   and not exists (
                       select 1
                         from card_statement_forecast forecast
                        where forecast.statement_id = statement.id
                          and statement.status in ('OPEN', 'FINALIZED')
                          and forecast.payment_amount_won > 0
                          and not exists (
                              select 1 from card_statement_payment payment
                               where payment.statement_id = statement.id
                                 and payment.payment_type = 'REGULAR'
                          )
                   )
                """, Timestamp.from(now), bookId, cardAssetId);
    }

    public void synchronizeCardChargeAnchors(
            UUID bookId, UUID cardAssetId, LocalDate openedOn, Instant now
    ) {
        List<UUID> statementIds = jdbcTemplate.query("""
                select distinct charge.statement_id
                  from card_charge charge
                 where charge.book_id = ? and charge.card_asset_id = ?
                   and charge.charge_origin = 'PURCHASE'
                 order by charge.statement_id
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, cardAssetId);
        jdbcTemplate.update("""
                update card_charge charge
                   set absorbed_by_balance_anchor = transaction.occurred_on < ?
                  from ledger_transaction transaction
                 where charge.book_id = ? and charge.card_asset_id = ?
                   and charge.charge_origin = 'PURCHASE'
                   and transaction.book_id = charge.book_id
                   and transaction.id = charge.source_transaction_id
                """, Date.valueOf(openedOn), bookId, cardAssetId);
        statementIds.forEach(statementId -> recalculateBilledAmount(statementId, now));
    }

    public int reassignTransactionPerformers(
            UUID bookId, UUID assetId, UUID newOwnerMemberId, UUID updaterMemberId, Instant now
    ) {
        return jdbcTemplate.update("""
                update ledger_transaction transaction
                   set performed_by_member_id = ?, updated_by_member_id = ?,
                       updated_at = ?, version = version + 1
                 where transaction.book_id = ?
                   and transaction.transaction_type in ('INCOME', 'EXPENSE')
                   and transaction.deleted_at is null
                   and exists (
                       select 1 from transaction_posting posting
                        where posting.book_id = transaction.book_id
                          and posting.transaction_id = transaction.id
                          and posting.asset_id = ?
                   )
                """, newOwnerMemberId, updaterMemberId, Timestamp.from(now), bookId, assetId);
    }

    private Optional<UUID> openingTransactionId(UUID bookId, UUID assetId) {
        return jdbcTemplate.query(
                "select id from ledger_transaction where book_id = ? and source_type = 'OPENING_BALANCE' and source_id = ?",
                rs -> rs.next() ? Optional.of(rs.getObject("id", UUID.class)) : Optional.empty(),
                bookId, assetId);
    }

    private Optional<UUID> findStatement(UUID assetId, LocalDate start, LocalDate end) {
        return jdbcTemplate.query(
                "select id from card_statement where card_asset_id = ? and cycle_start = ? and cycle_end = ?",
                rs -> rs.next() ? Optional.of(rs.getObject("id", UUID.class)) : Optional.empty(),
                assetId, Date.valueOf(start), Date.valueOf(end));
    }

    private void removeCardOpening(UUID transactionId, Instant now) {
        List<UUID> statementIds = jdbcTemplate.query(
                "select statement_id from card_charge where source_transaction_id = ? and charge_origin = 'OPENING_BALANCE'",
                (rs, rowNum) -> rs.getObject("statement_id", UUID.class), transactionId);
        jdbcTemplate.update(
                "delete from card_charge where source_transaction_id = ? and charge_origin = 'OPENING_BALANCE'",
                transactionId);
        for (UUID statementId : statementIds) {
            Integer count = jdbcTemplate.queryForObject(
                    "select count(*) from card_charge where statement_id = ?", Integer.class, statementId);
            if (count != null && count == 0) {
                jdbcTemplate.update("delete from card_payment_schedule where statement_id = ?", statementId);
                jdbcTemplate.update("delete from card_statement where id = ?", statementId);
            } else {
                recalculateBilledAmount(statementId, now);
            }
        }
    }

    private void recalculateBilledAmount(UUID statementId, Instant now) {
        jdbcTemplate.update("""
                update card_statement statement
                   set billed_amount_won = coalesce((
                       select sum(charge.principal_amount_won)
                         from card_charge charge
                         join ledger_transaction transaction
                           on transaction.book_id = charge.book_id
                          and transaction.id = charge.source_transaction_id
                        where charge.statement_id = statement.id
                          and not charge.absorbed_by_balance_anchor
                          and transaction.deleted_at is null
                   ), 0), updated_at = ?, version = version + 1
                 where statement.id = ?
                """, Timestamp.from(now), statementId);
    }

    private long absolute(long value) {
        if (value == Long.MIN_VALUE) {
            throw new IllegalArgumentException("opening balance is outside bigint magnitude");
        }
        return Math.abs(value);
    }

    private record ScheduleTarget(UUID statementId, LocalDate dueOn) {
    }
}
