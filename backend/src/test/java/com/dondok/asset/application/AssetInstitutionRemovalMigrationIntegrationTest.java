package com.dondok.asset.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class AssetInstitutionRemovalMigrationIntegrationTest {
    @Autowired private DataSource dataSource;

    @Test
    void removesOnlyInstitutionMetadataFromActiveAndArchivedAssets() throws Exception {
        String schema = "institution_retirement_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            String originalSchema = connection.getSchema();
            try {
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("38").load().migrate();
                connection.setSchema(schema);
                sql.execute("insert into app_user (id, display_name, email) values ('00000000-0000-0000-0000-000000000001', 'Fixture', 'icons@example.test')");
                sql.execute("insert into ledger_book (id, created_by_user_id) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')");
                sql.execute("insert into ledger_member (id, book_id, user_id) values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')");
                sql.execute("""
                        insert into asset_type(id, book_id, name, system_code, behavior, created_by_member_id)
                        select id::uuid, '00000000-0000-0000-0000-000000000002', name, code, behavior,
                               '00000000-0000-0000-0000-000000000003'
                        from (values ('00000000-0000-0000-0000-000000000009', 'Account', 'BANK', 'STANDARD'),
                                     ('00000000-0000-0000-0000-000000000010', 'Card', 'CREDIT_CARD', 'CREDIT_CARD')) f(id,name,code,behavior)
                        """);
                sql.execute("""
                        insert into asset(id, book_id, asset_type_id, owner_member_id, name, opened_on, balance_anchor_won,
                                          financial_institution_code, card_issuer_code, created_by_member_id, updated_by_member_id)
                        select id::uuid, '00000000-0000-0000-0000-000000000002', type_id::uuid,
                               '00000000-0000-0000-0000-000000000003', name, '2026-01-01', amount, bank, issuer,
                               '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003'
                        from (values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000009', 'Personal account', 123456, 'SB_SBI', null),
                                     ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', 'Personal card', -55000, null, 'SAMSUNG'),
                                     ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000009', 'Archived account', 8765, 'HANA', null)) f(id,type_id,name,amount,bank,issuer)
                        """);
                sql.execute("update asset set archived_at=now(), archived_by_member_id=owner_member_id where id='00000000-0000-0000-0000-000000000006'");
                sql.execute("""
                        insert into card_setting(card_asset_id,book_id,statement_closing_day,payment_day,payment_month_offset,settlement_asset_id)
                        values ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002',14,25,1,'00000000-0000-0000-0000-000000000004')
                        """);
                sql.execute("""
                        insert into ledger_transaction(id,book_id,transaction_type,transfer_subtype,transfer_purpose,occurred_on,amount_won,performed_by_member_id,created_by_member_id,source_type)
                        values ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000002','TRANSFER','NORMAL','GENERAL','2026-07-01',10000,'00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','MANUAL')
                        """);
                sql.execute("""
                        insert into transaction_posting(transaction_id,line_no,book_id,asset_id,delta_won)
                        select '00000000-0000-0000-0000-000000000007',line,'00000000-0000-0000-0000-000000000002',asset::uuid,delta
                        from (values (1,'00000000-0000-0000-0000-000000000004',-10000),(2,'00000000-0000-0000-0000-000000000006',10000)) f(line,asset,delta)
                        """);
                Map<String, String> queries = Map.of(
                        "assets", "select jsonb_agg(to_jsonb(a)-'financial_institution_code'-'card_issuer_code' order by id)::text from asset a",
                        "balances", "select jsonb_agg(to_jsonb(b) order by asset_id)::text from asset_current_balance b",
                        "transactions", "select jsonb_agg(to_jsonb(t) order by id)::text from ledger_transaction t",
                        "postings", "select jsonb_agg(to_jsonb(p) order by transaction_id,line_no)::text from transaction_posting p",
                        "settings", "select jsonb_agg(to_jsonb(s) order by card_asset_id)::text from card_setting s");
                Map<String, String> before = new LinkedHashMap<>();
                for (var entry : queries.entrySet()) before.put(entry.getKey(), snapshot(sql, entry.getValue()));
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
                for (var entry : queries.entrySet()) assertThat(snapshot(sql, entry.getValue())).as(entry.getKey()).isEqualTo(before.get(entry.getKey()));
                assertThat(snapshot(sql, "select count(*)::text from information_schema.columns where table_schema=current_schema() and table_name='asset' and column_name in ('financial_institution_code','card_issuer_code')")).isEqualTo("0");
                assertThat(snapshot(sql, "select count(*)::text from pg_indexes where schemaname=current_schema() and indexname in ('ix_asset_book_financial_institution_active','ix_asset_book_card_issuer_active')")).isEqualTo("0");
            } finally { connection.setSchema(originalSchema); }
        } finally {
            try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) { sql.execute("drop schema if exists " + schema + " cascade"); }
        }
    }

    private String snapshot(Statement sql, String query) throws SQLException {
        try (var rows = sql.executeQuery(query)) { assertThat(rows.next()).isTrue(); return rows.getString(1); }
    }
}
