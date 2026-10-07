package com.dondok.settlement.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class CardPaymentOwnerMigrationIntegrationTest {
    @Autowired
    private DataSource dataSource;

    @ParameterizedTest
    @ValueSource(strings = {"ACTIVE", "CANCELLED", "CANCELLED_WITHOUT_PAYMENT"})
    void backfillsActiveAndCancelledPaymentsWithoutChangingMoneyOrWriter(String legacyState) throws Exception {
        boolean cancelled = !legacyState.equals("ACTIVE");
        boolean unlinked = legacyState.equals("CANCELLED_WITHOUT_PAYMENT");
        String schema = "payment_owner_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            String originalSchema = connection.getSchema();
            try {
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                        .target("29").load().migrate();
                connection.setSchema(schema);
                seed(sql);
                if (cancelled) {
                    sql.execute("update ledger_transaction set deleted_at = now(), deleted_by_member_id = " + id(3));
                    sql.execute("update card_statement_payment set cancelled_at = now(), cancelled_by_member_id = " + id(3));
                }

                // Missing attribution must roll back even the otherwise resolvable row.
                sql.execute("delete from card_statement_payment where id = " + id(12));
                if (cancelled) sql.execute("delete from transaction_posting where transaction_id = " + id(10) + " and line_no = 2");
                Flyway latest = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load();
                assertThatThrownBy(latest::migrate).isInstanceOf(FlywayException.class)
                        .hasStackTraceContaining("ck_ledger_transaction_performer");
                try (var rows = sql.executeQuery("select count(*) from ledger_transaction where performed_by_member_id is null and version = 0")) {
                    rows.next();
                    assertThat(rows.getInt(1)).isEqualTo(2);
                }
                if (!unlinked) insertPayment(sql, 12, 10, "PREPAYMENT", id(3));
                if (cancelled) {
                    sql.execute("insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won) values ("
                            + id(10) + ", 2, " + id(2) + ", " + id(7) + ", 30000)");
                    sql.execute("update card_statement_payment set cancelled_at = now(), cancelled_by_member_id = " + id(3));
                }
                if (unlinked) sql.execute("delete from card_statement_payment");
                latest.migrate();
                try (var rows = sql.executeQuery("select performed_by_member_id, created_by_member_id, amount_won, occurred_on, version, deleted_at from ledger_transaction order by id")) {
                    for (int index = 0; index < 2; index++) {
                        assertThat(rows.next()).isTrue();
                        assertThat(rows.getString(1)).isEqualTo(uuid(4));
                        assertThat(rows.getString(2)).isEqualTo(index == 0 ? null : uuid(3));
                        assertThat(rows.getLong(3)).isEqualTo(30000);
                        assertThat(rows.getDate(4).toString()).isEqualTo("2026-07-15");
                        assertThat(rows.getLong(5)).isEqualTo(1);
                        assertThat(rows.getObject(6) != null).isEqualTo(cancelled);
                    }
                    assertThat(rows.next()).isFalse();
                }
                try (var rows = sql.executeQuery("select asset_id, sum(delta_won) from transaction_posting group by asset_id order by asset_id")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo(uuid(6));
                    assertThat(rows.getLong(2)).isEqualTo(-60000);
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo(uuid(7));
                    assertThat(rows.getLong(2)).isEqualTo(60000);
                }
                assertThatThrownBy(() -> sql.execute("update ledger_transaction set performed_by_member_id = null"))
                        .isInstanceOf(SQLException.class);
            } finally {
                connection.setSchema(originalSchema);
            }
        } finally {
            try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
                sql.execute("drop schema if exists " + schema + " cascade");
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"PAID", "FINALIZED"})
    void lateUsageMigrationRestoresResidualWithoutChangingHistoricalMoney(String status) throws Exception {
        String schema = "late_payment_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            String originalSchema = connection.getSchema();
            try {
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("29").load().migrate();
                connection.setSchema(schema);
                seed(sql);
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("31").load().migrate();
                sql.execute("update card_statement_payment set created_at = '2026-07-15T00:00:00Z'");
                sql.execute("update card_statement set status = '" + status + "', billed_amount_won = 120000, finalized_at = now(), settled_at = " + (status.equals("PAID") ? "now()" : "null") + "");
                sql.execute("insert into ledger_transaction (id, book_id, transaction_type, occurred_on, amount_won, source_type, source_id, created_by_member_id) values ("
                        + id(15) + ", " + id(2) + ", 'ADJUSTMENT', '2026-06-01', 120000, 'OPENING_BALANCE', " + id(7) + ", " + id(3) + ")");
                sql.execute("insert into card_charge (id, book_id, source_transaction_id, card_asset_id, statement_id, charge_origin, installment_no, installment_count, principal_amount_won, expected_settlement_on, created_at) values ("
                        + id(16) + ", " + id(2) + ", " + id(15) + ", " + id(7) + ", " + id(8) + ", 'OPENING_BALANCE', 1, 1, 120000, '2026-07-15', '2026-08-01T00:00:00Z')");
                sql.execute("insert into card_payment_schedule (id, book_id, statement_id, settlement_asset_id, scheduled_on) values ("
                        + id(17) + ", " + id(2) + ", " + id(8) + ", " + id(6) + ", '2026-07-15')");
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
                try (var rows = sql.executeQuery("select statement.status, additional_usage_after_payment, forecast.payment_amount_won, schedule.status from card_statement statement join card_statement_forecast forecast on forecast.statement_id = statement.id join card_payment_schedule schedule on schedule.statement_id = statement.id")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo("FINALIZED");
                    assertThat(rows.getBoolean(2)).isTrue();
                    assertThat(rows.getLong(3)).isEqualTo(60000);
                    assertThat(rows.getString(4)).isEqualTo("CANCELLED");
                }
                try (var rows = sql.executeQuery("select sum(amount_won), count(*) from card_statement_payment")) {
                    rows.next(); assertThat(rows.getLong(1)).isEqualTo(60000); assertThat(rows.getInt(2)).isEqualTo(2);
                }
                try (var rows = sql.executeQuery("select sum(delta_won) from transaction_posting where asset_id = " + id(6))) {
                    rows.next(); assertThat(rows.getLong(1)).isEqualTo(-60000);
                }
            } finally { connection.setSchema(originalSchema); }
        } finally {
            try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
                sql.execute("drop schema if exists " + schema + " cascade");
            }
        }
    }

    private void seed(Statement sql) throws SQLException {
        sql.execute("insert into app_user (id, display_name, email) values (" + id(1)
                + ", 'Payer', 'payer@example.test'), (" + id(13) + ", 'Card owner', 'card@example.test')");
        sql.execute("insert into ledger_book (id, created_by_user_id) values (" + id(2) + ", " + id(1) + ")");
        sql.execute("insert into ledger_member (id, book_id, user_id) values (" + id(3) + ", " + id(2) + ", " + id(1)
                + "), (" + id(4) + ", " + id(2) + ", " + id(13) + ")");
        sql.execute("insert into asset_type (id, book_id, name, system_code, created_by_member_id) values ("
                + id(5) + ", " + id(2) + ", 'Bank', 'BANK', " + id(3) + "), ("
                + id(14) + ", " + id(2) + ", 'Card', 'CREDIT_CARD', " + id(3) + ")");
        sql.execute("update asset_type set behavior = 'CREDIT_CARD' where id = " + id(14));
        sql.execute("""
                insert into asset (id, book_id, asset_type_id, ownership_scope, owner_member_id,
                                   name, opened_on, balance_anchor_won, created_by_member_id, updated_by_member_id)
                values (%s, %s, %s, 'PERSONAL', %s, 'Bank', '2026-01-01', 0, %s, %s),
                       (%s, %s, %s, 'PERSONAL', %s, 'Card', '2026-01-01', 0, %s, %s)
                """.formatted(id(6), id(2), id(5), id(3), id(3), id(3),
                              id(7), id(2), id(14), id(4), id(3), id(3)));
        sql.execute("insert into card_statement (id, book_id, card_asset_id, cycle_start, cycle_end, due_on) values ("
                + id(8) + ", " + id(2) + ", " + id(7) + ", '2026-06-01', '2026-06-30', '2026-07-15')");
        sql.execute("""
                insert into ledger_transaction (id, book_id, transaction_type, transfer_subtype, occurred_on,
                                                amount_won, source_type, created_by_member_id)
                values (%s, %s, 'TRANSFER', 'CARD_SETTLEMENT', '2026-07-15', 30000, 'CARD_AUTOPAY', null),
                       (%s, %s, 'TRANSFER', 'CARD_PREPAYMENT', '2026-07-15', 30000, 'CARD_PREPAYMENT', %s)
                """.formatted(id(9), id(2), id(10), id(2), id(3)));
        for (int transaction : new int[]{9, 10}) {
            sql.execute("insert into transaction_posting (transaction_id, line_no, book_id, asset_id, delta_won) values ("
                    + id(transaction) + ", 1, " + id(2) + ", " + id(6) + ", -30000), ("
                    + id(transaction) + ", 2, " + id(2) + ", " + id(7) + ", 30000)");
        }
        insertPayment(sql, 11, 9, "REGULAR", "null");
        insertPayment(sql, 12, 10, "PREPAYMENT", id(3));
    }

    private void insertPayment(Statement sql, int payment, int transaction, String type, String creator) throws SQLException {
        sql.execute("""
                insert into card_statement_payment (id, book_id, statement_id, payment_type, settlement_asset_id,
                                                    amount_won, paid_on, settlement_transaction_id, created_by_member_id)
                values (%s, %s, %s, '%s', %s, 30000, '2026-07-15', %s, %s)
                """.formatted(id(payment), id(2), id(8), type, id(6), id(transaction), creator));
    }

    private String uuid(int value) { return new UUID(0, value).toString(); }
    private String id(int value) { return "'" + uuid(value) + "'"; }
}
