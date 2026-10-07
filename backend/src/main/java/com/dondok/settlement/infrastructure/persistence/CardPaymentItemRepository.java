package com.dondok.settlement.infrastructure.persistence;

import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CardPaymentItemRepository {
    private final JdbcTemplate jdbc;
    public CardPaymentItemRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Card card(UUID book, UUID card) {
        var rows = jdbc.query("""
                select a.owner_member_id, a.archived_at is not null archived, c.statement_closing_day,
                    md5(a.version::text || ':' || c.version::text || ':' || coalesce((
                        select string_agg(s.id::text || ':' || s.version::text, ',' order by s.id)
                        from card_statement s where s.book_id = a.book_id and s.card_asset_id = a.id
                    ), '')) token
                from asset a join card_setting c on c.book_id = a.book_id and c.card_asset_id = a.id
                join asset_type t on t.book_id = a.book_id and t.id = a.asset_type_id and t.behavior = 'CREDIT_CARD'
                where a.book_id = ? and a.id = ?
                """, (rs, n) -> new Card(rs.getObject("owner_member_id", UUID.class), rs.getBoolean("archived"),
                rs.getInt("statement_closing_day"), rs.getString("token")), book, card);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public Totals totals(UUID book, UUID card, LocalDate closing) {
        return jdbc.queryForObject("""
                select coalesce(sum(remaining_amount_won), 0) amount, count(*) count,
                    coalesce(sum(remaining_amount_won) filter (where cycle_end <= ?), 0) closed_amount,
                    count(*) filter (where cycle_end <= ?) closed_count
                from card_payable_items(?, ?) where remaining_amount_won > 0
                """, (rs, n) -> new Totals(rs.getLong("amount"), rs.getLong("count"),
                rs.getLong("closed_amount"), rs.getLong("closed_count")), Date.valueOf(closing), Date.valueOf(closing), book, card);
    }

    public List<Item> items(UUID book, UUID card, LocalDate closing, Cursor cursor, int limit,
                            String base, List<UUID> included, List<UUID> excluded) {
        List<Object> args = new ArrayList<>(List.of(book, card));
        String selection = "";
        if (base != null) {
            selection = " and ((? = 'ALL' or (? = 'CLOSED' and cycle_end <= ?) or charge_id = any(?::uuid[])) and not (charge_id = any(?::uuid[])))";
            args.add(base); args.add(base); args.add(Date.valueOf(closing));
            args.add(array(included)); args.add(array(excluded));
        }
        String after = "";
        if (cursor != null) {
            after = " and (due_on, occurred_on, charge_id) > (?, ?, ?)";
            args.add(Date.valueOf(cursor.dueOn())); args.add(Date.valueOf(cursor.occurredOn())); args.add(cursor.chargeId());
        }
        args.add(limit);
        return jdbc.query("select * from card_payable_items(?, ?) where remaining_amount_won > 0" + selection + after
            + " order by due_on, occurred_on, charge_id limit ?", (rs, n) -> new Item(
                rs.getObject("charge_id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getObject("source_transaction_id", UUID.class), rs.getInt("installment_no"), rs.getInt("installment_count"),
                rs.getObject("occurred_on", LocalDate.class), rs.getString("description"),
                rs.getObject("cycle_end", LocalDate.class), rs.getObject("due_on", LocalDate.class),
                rs.getLong("remaining_amount_won"), rs.getString("origin")), args.toArray());
    }

    public void allocate(UUID book, UUID payment, UUID batch, Item item, long amount) {
        jdbc.update("update card_statement_payment set user_payment_batch_id = ? where book_id = ? and id = ?", batch, book, payment);
        jdbc.update("""
                insert into card_payment_item_allocation(book_id, payment_id, source_transaction_id, installment_no, amount_won)
                values (?, ?, ?, ?, ?)
                """, book, payment, item.sourceTransactionId(), item.installmentNo(), amount);
    }

    public List<BatchPayment> batch(UUID book, UUID batch) {
        return jdbc.query("""
                select id, statement_id, amount_won, cancelled_at is not null cancelled
                from card_statement_payment where book_id = ? and user_payment_batch_id = ? order by id
                """, (rs, n) -> new BatchPayment(rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getLong("amount_won"), rs.getBoolean("cancelled")), book, batch);
    }

    private String array(List<UUID> ids) { return "{" + String.join(",", ids.stream().map(UUID::toString).toList()) + "}"; }
    public record Card(UUID ownerMemberId, boolean archived, int closingDay, String token) {}
    public record Totals(long amountWon, long count, long closedAmountWon, long closedCount) {}
    public record Cursor(LocalDate dueOn, LocalDate occurredOn, UUID chargeId) {}
    public record Item(UUID chargeId, UUID statementId, UUID sourceTransactionId, int installmentNo, int installmentCount,
                       LocalDate occurredOn, String description, LocalDate cycleEnd, LocalDate dueOn, long remainingAmountWon, String origin) {}
    public record BatchPayment(UUID paymentId, UUID statementId, long amountWon, boolean cancelled) {}
}
