package com.dondok.transaction.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class TransferPurposeMigrationIntegrationTest {
    @Autowired private DataSource dataSource;

    @Test
    void upgradesLegacyTransfersWithoutChangingAnyAmountsActorsOrPostings() throws Exception {
        String schema = "transfer_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            String originalSchema = connection.getSchema();
            try {
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("32").load().migrate();
                connection.setSchema(schema);
                sql.execute("insert into app_user (id, display_name, email) values ('00000000-0000-0000-0000-000000000001', 'Fixture', 'transfer@example.test')");
                sql.execute("insert into ledger_book (id, created_by_user_id) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')");
                sql.execute("insert into ledger_member (id, book_id, user_id) values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')");
                sql.execute("""
                        insert into asset_type(id, book_id, name, system_code, created_by_member_id)
                        values ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002',
                                'Account', 'BANK', '00000000-0000-0000-0000-000000000003')
                        """);
                sql.execute("""
                        insert into asset(id, book_id, asset_type_id, owner_member_id, name, opened_on, balance_anchor_won, created_by_member_id, updated_by_member_id)
                        select id::uuid, '00000000-0000-0000-0000-000000000002',
                               (select id from asset_type where system_code = 'BANK'),
                               '00000000-0000-0000-0000-000000000003', name, '2026-01-01', 123456,
                               '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003'
                          from (values ('00000000-0000-0000-0000-000000000004', 'Source'),
                                       ('00000000-0000-0000-0000-000000000005', 'Destination')) fixture(id, name)
                        """);
                sql.execute("""
                        insert into ledger_transaction(id, book_id, transaction_type, transfer_subtype, occurred_on, amount_won,
                                                       performed_by_member_id, created_by_member_id, source_type)
                        select id::uuid, '00000000-0000-0000-0000-000000000002', 'TRANSFER', subtype, '2026-07-01', 10000,
                               '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', source
                          from (values ('00000000-0000-0000-0000-000000000006', 'NORMAL', 'MANUAL'),
                                       ('00000000-0000-0000-0000-000000000007', 'NORMAL', 'MANUAL'),
                                       ('00000000-0000-0000-0000-000000000008', 'CARD_PREPAYMENT', 'CARD_PREPAYMENT')) fixture(id, subtype, source)
                        """);
                sql.execute("update ledger_transaction set deleted_at = now(), deleted_by_member_id = '00000000-0000-0000-0000-000000000003' where id = '00000000-0000-0000-0000-000000000007'");
                sql.execute("""
                        insert into transaction_posting(transaction_id, line_no, book_id, asset_id, delta_won)
                        select t.id, p.line, t.book_id, p.asset::uuid, p.delta
                          from ledger_transaction t cross join (values
                              (1, '00000000-0000-0000-0000-000000000004', -10000),
                              (2, '00000000-0000-0000-0000-000000000005', 10000)) p(line, asset, delta)
                        """);
                String transactionsBefore = snapshot(sql, "select jsonb_agg(to_jsonb(t) - 'transfer_purpose' order by id)::text from ledger_transaction t");
                String postingsBefore = snapshot(sql, "select jsonb_agg(to_jsonb(p) order by transaction_id, line_no)::text from transaction_posting p");
                String balancesBefore = snapshot(sql, "select jsonb_agg(to_jsonb(b) order by asset_id)::text from asset_current_balance b");
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
                assertThat(snapshot(sql, "select jsonb_agg(to_jsonb(t) - 'transfer_purpose' order by id)::text from ledger_transaction t")).isEqualTo(transactionsBefore);
                assertThat(snapshot(sql, "select jsonb_agg(to_jsonb(p) order by transaction_id, line_no)::text from transaction_posting p")).isEqualTo(postingsBefore);
                assertThat(snapshot(sql, "select jsonb_agg(to_jsonb(b) order by asset_id)::text from asset_current_balance b")).isEqualTo(balancesBefore);
                assertThat(snapshot(sql, "select count(*)::text from ledger_transaction where transfer_purpose = 'GENERAL'")).isEqualTo("2");
                assertThat(snapshot(sql, "select count(*)::text from ledger_transaction where transfer_subtype = 'CARD_PREPAYMENT' and transfer_purpose is null")).isEqualTo("1");
                assertThatThrownBy(() -> sql.execute("update ledger_transaction set transfer_purpose = 'SAVINGS_DEPOSIT' where transfer_subtype = 'CARD_PREPAYMENT'"))
                        .isInstanceOf(SQLException.class);
                assertThatThrownBy(() -> sql.execute("update ledger_transaction set transfer_purpose = 'UNKNOWN' where transfer_subtype = 'NORMAL'"))
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

    private String snapshot(Statement sql, String query) throws SQLException {
        try (var rows = sql.executeQuery(query)) {
            assertThat(rows.next()).isTrue();
            return rows.getString(1);
        }
    }
}
