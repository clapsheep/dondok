package com.dondok.auth.application;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.Connection;
import java.sql.Statement;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "dondok.mail.enabled=false")
class AccountErasureMigrationIntegrationTest {
    @Autowired DataSource dataSource;

    @Test void upgradesLegacyWithdrawnAccountsWithoutChangingRemainingLedgerBalance() throws Exception {
        String schema = "erasure_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            String original = connection.getSchema();
            try {
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("35").load().migrate();
                connection.setSchema(schema);
                sql.execute("""
                    insert into app_user(id, display_name, email, status, email_verified_at, withdrawn_at) values
                    ('00000000-0000-0000-0000-000000000001','Old identity','old@example.test','WITHDRAWN',now(),now()),
                    ('00000000-0000-0000-0000-000000000002','Remaining','remaining@example.test','ACTIVE',now(),null);
                    insert into ledger_book(id, created_by_user_id) values
                    ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001');
                    insert into ledger_member(id, book_id, user_id) values
                    ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'),
                    ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002');
                    insert into asset_type(id, book_id, name, system_code, created_by_member_id) values
                    ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','Cash','CASH','00000000-0000-0000-0000-000000000004');
                    insert into asset(id, book_id, asset_type_id, owner_member_id, name, memo, opened_on,
                        balance_anchor_won, created_by_member_id, updated_by_member_id) values
                    ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000003',
                     '00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004',
                     'Personal label','Personal memo','2026-01-01',12345,'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004');
                    """);
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
                try (var result = sql.executeQuery("select count(*) from app_user where status = 'WITHDRAWN'")) {
                    result.next(); assertThat(result.getInt(1)).isZero();
                }
                try (var result = sql.executeQuery("select a.name, a.memo, m.user_id, b.current_balance_won from asset a join ledger_member m on m.id = a.owner_member_id join asset_current_balance b on b.asset_id = a.id")) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getString(1)).startsWith("기록 자산 ");
                    assertThat(result.getString(2)).isNull();
                    assertThat(result.getObject(3)).isNull();
                    assertThat(result.getLong(4)).isEqualTo(12345);
                }
            } finally {
                connection.setSchema(original);
                sql.execute("drop schema if exists " + schema + " cascade");
            }
        }
    }
}
