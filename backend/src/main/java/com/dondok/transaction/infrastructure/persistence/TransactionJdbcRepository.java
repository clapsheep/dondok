package com.dondok.transaction.infrastructure.persistence;

import com.dondok.asset.domain.CardBillingCyclePolicy;
import com.dondok.asset.infrastructure.persistence.CardSettingEntity;
import com.dondok.common.id.UuidV7;
import com.dondok.transaction.domain.TransactionType;
import com.dondok.transaction.domain.TransferSubtype;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TransactionJdbcRepository {
    private final JdbcTemplate jdbcTemplate;

    public TransactionJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void insertTransaction(TransactionWrite write) {
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, transfer_subtype, occurred_on, amount_won,
                    category_id, performed_by_member_id, primary_asset_id, description, source_type,
                    created_by_member_id, updated_by_member_id, created_at, updated_at, version
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, 0)
                """, write.transactionId(), write.bookId(), write.type().name(),
                write.transferSubtype() == null ? null : write.transferSubtype().name(),
                Date.valueOf(write.occurredOn()), write.amountWon(), write.categoryId(),
                write.performedByMemberId(), write.primaryAssetId(), write.description(), write.createdByMemberId(),
                write.createdByMemberId(), Timestamp.from(write.now()), Timestamp.from(write.now()));
        short line = 1;
        for (PostingWrite posting : write.postings()) {
            jdbcTemplate.update("""
                    insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
                    values (?, ?, ?, ?, ?)
                    """, write.transactionId(), line++, write.bookId(), posting.assetId(), posting.deltaWon());
        }
    }

    public void insertCardInstallments(
            UUID bookId,
            UUID transactionId,
            UUID cardAssetId,
            List<InstallmentWrite> installments,
            CardSettingEntity setting,
            Instant now
    ) {
        jdbcTemplate.update("""
                insert into card_purchase_billing_snapshot (
                    purchase_transaction_id, book_id, card_asset_id, statement_closing_day,
                    payment_day, payment_month_offset, installment_count, created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, transactionId, bookId, cardAssetId, setting.getStatementClosingDay(),
                setting.getPaymentDay(), setting.getPaymentMonthOffset(), installments.size(),
                Timestamp.from(now), Timestamp.from(now));
        for (InstallmentWrite installment : installments) {
            CardBillingCyclePolicy.Cycle cycle = installment.cycle();
            UUID candidate = UuidV7.next();
            jdbcTemplate.update("""
                    insert into card_statement (
                        id, book_id, card_asset_id, cycle_start, cycle_end, due_on,
                        status, billed_amount_won, created_at, updated_at, version
                    ) values (?, ?, ?, ?, ?, ?, 'OPEN', 0, ?, ?, 0)
                    on conflict (card_asset_id, cycle_start, cycle_end) do nothing
                    """, candidate, bookId, cardAssetId, Date.valueOf(cycle.start()),
                    Date.valueOf(cycle.end()), Date.valueOf(cycle.dueOn()),
                    Timestamp.from(now), Timestamp.from(now));
            UUID statementId = jdbcTemplate.queryForObject("""
                    select id from card_statement
                     where card_asset_id = ? and cycle_start = ? and cycle_end = ?
                    """, UUID.class, cardAssetId, Date.valueOf(cycle.start()), Date.valueOf(cycle.end()));
            LocalDate dueOn = jdbcTemplate.queryForObject(
                    "select due_on from card_statement where id = ?", LocalDate.class, statementId);
            jdbcTemplate.update("""
                    insert into card_charge (
                        id, book_id, source_transaction_id, card_asset_id, statement_id,
                        charge_origin, installment_no, installment_count, principal_amount_won,
                        expected_settlement_on, created_at
                    ) values (?, ?, ?, ?, ?, 'PURCHASE', ?, ?, ?, ?, ?)
                    """, UuidV7.next(), bookId, transactionId, cardAssetId, statementId,
                    installment.number(), installments.size(), installment.amountWon(),
                    Date.valueOf(dueOn), Timestamp.from(now));
            recalculateStatement(statementId, now);
            if (setting.isAutoSettlementEnabled() && setting.getSettlementAssetId() != null) {
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
                        """, UuidV7.next(), bookId, statementId, setting.getSettlementAssetId(),
                        Date.valueOf(dueOn), Timestamp.from(now), Timestamp.from(now));
            }
        }
    }

    public List<CalendarRow> calendar(UUID bookId, LocalDate from, LocalDate toExclusive) {
        return jdbcTemplate.query("""
                select occurred_on,
                       coalesce(sum(statistics_amount_won)
                           filter (where transaction_type = 'INCOME'), 0) income_won,
                       coalesce(sum(statistics_amount_won)
                           filter (where transaction_type = 'EXPENSE'), 0) expense_won
                  from ledger_financial_activity
                 where book_id = ? and occurred_on >= ? and occurred_on < ?
                 group by occurred_on
                 order by occurred_on
                """, (rs, rowNum) -> new CalendarRow(
                rs.getObject("occurred_on", LocalDate.class), rs.getLong("income_won"),
                rs.getLong("expense_won")), bookId, Date.valueOf(from), Date.valueOf(toExclusive));
    }

    public PageRows page(UUID bookId, LocalDate from, LocalDate toExclusive, Cursor cursor, int limit) {
        List<Object> arguments = new ArrayList<>();
        arguments.add(bookId);
        arguments.add(Date.valueOf(from));
        arguments.add(Date.valueOf(toExclusive));
        String cursorClause = "";
        if (cursor != null) {
            cursorClause = " and (transaction.occurred_on, transaction.created_at, transaction.id) < (?, ?, ?)";
            arguments.add(Date.valueOf(cursor.occurredOn()));
            arguments.add(Timestamp.from(cursor.createdAt()));
            arguments.add(cursor.id());
        }
        arguments.add(limit + 1);
        String sql = """
                with selected as (
                    select transaction.id, transaction.occurred_on, transaction.created_at
                      from ledger_transaction transaction
                     where transaction.book_id = ? and transaction.occurred_on >= ?
                       and transaction.occurred_on < ? and transaction.deleted_at is null
                       and transaction.transaction_type in ('INCOME', 'EXPENSE', 'TRANSFER')
                """ + cursorClause + """
                     order by transaction.occurred_on desc, transaction.created_at desc,
                              transaction.id desc
                     limit ?
                )
                select transaction.id transaction_id, transaction.transaction_type,
                       transaction.transfer_subtype, transaction.occurred_on, transaction.amount_won,
                       transaction.source_type, transaction.description, transaction.version, transaction.created_at,
                       transaction.updated_at, category.id category_id, category.name category_name,
                       refund.purchase_transaction_id related_purchase_transaction_id,
                       performer.id performer_id, performer_user.display_name performer_name,
                       creator.id creator_id, creator_user.display_name creator_name,
                       selected_asset.id primary_asset_id, selected_asset.name primary_asset_name,
                       posting.line_no, posting.asset_id, asset.name asset_name, posting.delta_won,
                       (select max(charge.installment_count) from card_charge charge
                         where charge.source_transaction_id = transaction.id) installment_count
                  from selected
                  join ledger_transaction transaction on transaction.id = selected.id
                  left join category on category.book_id = transaction.book_id
                                    and category.id = transaction.category_id
                  left join card_purchase_refund refund
                    on refund.book_id = transaction.book_id
                   and refund.refund_transaction_id = transaction.id
                  left join ledger_member performer on performer.book_id = transaction.book_id
                                               and performer.id = transaction.performed_by_member_id
                  left join app_user performer_user on performer_user.id = performer.user_id
                  left join ledger_member creator on creator.book_id = transaction.book_id
                                             and creator.id = transaction.created_by_member_id
                  left join app_user creator_user on creator_user.id = creator.user_id
                  left join asset selected_asset on selected_asset.book_id = transaction.book_id
                                                and selected_asset.id = transaction.primary_asset_id
                  join transaction_posting posting on posting.book_id = transaction.book_id
                                                   and posting.transaction_id = transaction.id
                  join asset on asset.book_id = posting.book_id and asset.id = posting.asset_id
                 order by transaction.occurred_on desc, transaction.created_at desc,
                          transaction.id desc, posting.line_no asc
                """;
        List<ReadRow> rows = jdbcTemplate.query(sql, this::readRow, arguments.toArray());
        LinkedHashMap<UUID, TransactionRows> grouped = new LinkedHashMap<>();
        for (ReadRow row : rows) {
            grouped.computeIfAbsent(row.transactionId(), ignored -> new TransactionRows(row, new ArrayList<>()))
                    .postings().add(new PostingRow(row.lineNo(), row.assetId(), row.assetName(), row.deltaWon()));
        }
        List<TransactionRows> transactions = new ArrayList<>(grouped.values());
        boolean hasNext = transactions.size() > limit;
        if (hasNext) {
            transactions = new ArrayList<>(transactions.subList(0, limit));
        }
        String nextCursor = hasNext && !transactions.isEmpty()
                ? Cursor.from(transactions.get(transactions.size() - 1).transaction()).encode()
                : null;
        return new PageRows(transactions, nextCursor);
    }

    public TransactionRows find(UUID bookId, UUID transactionId) {
        List<ReadRow> rows = jdbcTemplate.query("""
                select transaction.id transaction_id, transaction.transaction_type,
                       transaction.transfer_subtype, transaction.occurred_on, transaction.amount_won,
                       transaction.source_type, transaction.description, transaction.version, transaction.created_at,
                       transaction.updated_at, category.id category_id, category.name category_name,
                       refund.purchase_transaction_id related_purchase_transaction_id,
                       performer.id performer_id, performer_user.display_name performer_name,
                       creator.id creator_id, creator_user.display_name creator_name,
                       selected_asset.id primary_asset_id, selected_asset.name primary_asset_name,
                       posting.line_no, posting.asset_id, asset.name asset_name, posting.delta_won,
                       (select max(charge.installment_count) from card_charge charge
                         where charge.source_transaction_id = transaction.id) installment_count
                  from ledger_transaction transaction
                  left join category on category.book_id = transaction.book_id and category.id = transaction.category_id
                  left join card_purchase_refund refund on refund.book_id = transaction.book_id
                                                        and refund.refund_transaction_id = transaction.id
                  left join ledger_member performer on performer.book_id = transaction.book_id and performer.id = transaction.performed_by_member_id
                  left join app_user performer_user on performer_user.id = performer.user_id
                  left join ledger_member creator on creator.book_id = transaction.book_id and creator.id = transaction.created_by_member_id
                  left join app_user creator_user on creator_user.id = creator.user_id
                  left join asset selected_asset on selected_asset.book_id = transaction.book_id
                                                and selected_asset.id = transaction.primary_asset_id
                  join transaction_posting posting on posting.book_id = transaction.book_id and posting.transaction_id = transaction.id
                  join asset on asset.book_id = posting.book_id and asset.id = posting.asset_id
                 where transaction.book_id = ? and transaction.id = ? and transaction.deleted_at is null
                   and transaction.transaction_type in ('INCOME', 'EXPENSE', 'TRANSFER')
                 order by posting.line_no
                """, this::readRow, bookId, transactionId);
        if (rows.isEmpty()) {
            return null;
        }
        List<PostingRow> postings = rows.stream().map(row -> new PostingRow(
                row.lineNo(), row.assetId(), row.assetName(), row.deltaWon())).toList();
        return new TransactionRows(rows.get(0), new ArrayList<>(postings));
    }

    public TransactionState findStateForUpdate(UUID bookId, UUID transactionId) {
        List<TransactionState> rows = jdbcTemplate.query("""
                select transaction.id, transaction.transaction_type, transaction.transfer_subtype,
                       transaction.source_type, transaction.version, transaction.primary_asset_id,
                       (select posting.asset_id
                          from transaction_posting posting
                         where posting.transaction_id = transaction.id
                         order by posting.line_no
                         limit 1) posting_asset_id
                  from ledger_transaction transaction
                 where transaction.book_id = ? and transaction.id = ? and transaction.deleted_at is null
                 for update
                """, (resultSet, rowNum) -> new TransactionState(
                resultSet.getObject("id", UUID.class),
                TransactionType.valueOf(resultSet.getString("transaction_type")),
                resultSet.getString("transfer_subtype") == null ? null
                        : TransferSubtype.valueOf(resultSet.getString("transfer_subtype")),
                resultSet.getString("source_type"),
                resultSet.getLong("version"),
                resultSet.getObject("primary_asset_id", UUID.class),
                resultSet.getObject("posting_asset_id", UUID.class)), bookId, transactionId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public boolean hasCardCharges(UUID transactionId) {
        Boolean result = jdbcTemplate.queryForObject(
                "select exists(select 1 from card_charge where source_transaction_id = ?)",
                Boolean.class, transactionId);
        return Boolean.TRUE.equals(result);
    }

    public void updateTransaction(TransactionUpdateWrite write) {
        int updated = jdbcTemplate.update("""
                update ledger_transaction
                   set occurred_on = ?, amount_won = ?, category_id = ?,
                       performed_by_member_id = ?, primary_asset_id = ?, description = ?,
                       updated_by_member_id = ?, updated_at = ?, version = version + 1
                 where book_id = ? and id = ? and deleted_at is null and version = ?
                """, Date.valueOf(write.occurredOn()), write.amountWon(), write.categoryId(),
                write.performedByMemberId(), write.primaryAssetId(), write.description(),
                write.updatedByMemberId(), Timestamp.from(write.now()), write.bookId(),
                write.transactionId(), write.expectedVersion());
        if (updated != 1) {
            throw new IllegalStateException("locked transaction update did not affect one row");
        }
        jdbcTemplate.update("delete from transaction_posting where transaction_id = ?", write.transactionId());
        short line = 1;
        for (PostingWrite posting : write.postings()) {
            jdbcTemplate.update("""
                    insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won)
                    values (?, ?, ?, ?, ?)
                    """, write.transactionId(), line++, write.bookId(), posting.assetId(), posting.deltaWon());
        }
    }

    public void softDelete(
            UUID bookId,
            UUID transactionId,
            long expectedVersion,
            UUID deletedByMemberId,
            Instant now
    ) {
        int updated = jdbcTemplate.update("""
                update ledger_transaction
                   set deleted_at = ?, deleted_by_member_id = ?, updated_at = ?,
                       updated_by_member_id = ?, version = version + 1
                 where book_id = ? and id = ? and deleted_at is null and version = ?
                """, Timestamp.from(now), deletedByMemberId, Timestamp.from(now), deletedByMemberId,
                bookId, transactionId, expectedVersion);
        if (updated != 1) {
            throw new IllegalStateException("locked transaction delete did not affect one row");
        }
    }

    public static Cursor decodeCursor(String encoded) {
        if (encoded == null || encoded.isBlank()) {
            return null;
        }
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(encoded)).split("\\|", 3);
            return new Cursor(LocalDate.parse(parts[0]), Instant.parse(parts[1]), UUID.fromString(parts[2]));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("invalid cursor", exception);
        }
    }

    private ReadRow readRow(ResultSet rs, int rowNum) throws SQLException {
        return new ReadRow(
                rs.getObject("transaction_id", UUID.class), TransactionType.valueOf(rs.getString("transaction_type")),
                rs.getString("transfer_subtype") == null ? null : TransferSubtype.valueOf(rs.getString("transfer_subtype")),
                rs.getString("source_type"), rs.getObject("occurred_on", LocalDate.class), rs.getLong("amount_won"),
                rs.getString("description"), rs.getLong("version"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant(),
                rs.getObject("category_id", UUID.class), rs.getString("category_name"),
                rs.getObject("related_purchase_transaction_id", UUID.class),
                rs.getObject("performer_id", UUID.class), rs.getString("performer_name"),
                rs.getObject("creator_id", UUID.class), rs.getString("creator_name"),
                rs.getObject("primary_asset_id", UUID.class), rs.getString("primary_asset_name"),
                rs.getShort("line_no"), rs.getObject("asset_id", UUID.class),
                rs.getString("asset_name"), rs.getLong("delta_won"),
                rs.getObject("installment_count", Integer.class));
    }

    private void recalculateStatement(UUID statementId, Instant now) {
        LocalDate today = now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate();
        jdbcTemplate.update("""
                update card_statement statement
                   set billed_amount_won = coalesce((
                       select sum(charge.principal_amount_won) from card_charge charge
                        where charge.statement_id = statement.id
                   ), 0),
                       status = case
                           when statement.status = 'PAID' and statement.due_on > ? then 'OPEN'
                           when statement.status = 'PAID' then 'FINALIZED'
                           else statement.status
                       end,
                       finalized_at = case
                           when statement.status = 'PAID' and statement.due_on > ? then null
                           else statement.finalized_at
                       end,
                       settled_at = case
                           when statement.status = 'PAID' then null
                           else statement.settled_at
                       end,
                       updated_at = ?, version = version + 1
                 where statement.id = ?
                """, Date.valueOf(today), Date.valueOf(today), Timestamp.from(now), statementId);
    }

    public record PostingWrite(UUID assetId, long deltaWon) {
    }
    public record TransactionWrite(UUID transactionId, UUID bookId, TransactionType type,
                                   TransferSubtype transferSubtype, LocalDate occurredOn, long amountWon,
                                   UUID categoryId, UUID performedByMemberId, UUID primaryAssetId, String description,
                                   UUID createdByMemberId, Instant now, List<PostingWrite> postings) {
    }
    public record TransactionUpdateWrite(
            UUID transactionId,
            UUID bookId,
            LocalDate occurredOn,
            long amountWon,
            UUID categoryId,
            UUID performedByMemberId,
            UUID primaryAssetId,
            String description,
            UUID updatedByMemberId,
            long expectedVersion,
            Instant now,
            List<PostingWrite> postings
    ) {
    }
    public record InstallmentWrite(int number, long amountWon, CardBillingCyclePolicy.Cycle cycle) {
    }
    public record CalendarRow(LocalDate date, long incomeWon, long expenseWon) {
    }
    public record PostingRow(short lineNo, UUID assetId, String assetName, long deltaWon) {
    }
    public record ReadRow(UUID transactionId, TransactionType type, TransferSubtype transferSubtype,
                          String sourceType, LocalDate occurredOn, long amountWon, String description, long version,
                          Instant createdAt, Instant updatedAt, UUID categoryId, String categoryName,
                          UUID relatedPurchaseTransactionId,
                          UUID performerId, String performerName, UUID creatorId, String creatorName,
                          UUID primaryAssetId, String primaryAssetName,
                          short lineNo, UUID assetId, String assetName, long deltaWon,
                          Integer installmentCount) {
    }
    public record TransactionRows(ReadRow transaction, List<PostingRow> postings) {
    }
    public record TransactionState(UUID transactionId, TransactionType type,
                                   TransferSubtype transferSubtype, String sourceType, long version,
                                   UUID primaryAssetId, UUID postingAssetId) {
    }
    public record PageRows(List<TransactionRows> items, String nextCursor) {
    }
    public record Cursor(LocalDate occurredOn, Instant createdAt, UUID id) {
        private static Cursor from(ReadRow row) {
            return new Cursor(row.occurredOn(), row.createdAt(), row.transactionId());
        }

        private String encode() {
            String raw = occurredOn + "|" + createdAt + "|" + id;
            return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes());
        }
    }
}
