package com.dondok.asset.application;

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
class AssetOwnershipMigrationIntegrationTest {
    @Autowired
    private DataSource dataSource;

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void refusesActiveOrArchivedJointAssetsWithoutInferringOwners(boolean archived) throws Exception {
        String schema = "owner_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            String originalSchema = connection.getSchema();
            try {
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                        .target("28").load().migrate();
                connection.setSchema(schema);
                sql.execute("insert into app_user (id, display_name, email) values "
                        + "('00000000-0000-0000-0000-000000000001', 'Migration fixture', 'owner@example.test')");
                sql.execute("insert into ledger_book (id, created_by_user_id) values "
                        + "('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')");
                sql.execute("insert into ledger_member (id, book_id, user_id) values "
                        + "('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', "
                        + "'00000000-0000-0000-0000-000000000001')");
                sql.execute("""
                        insert into asset_type (id, book_id, name, system_code, created_by_member_id)
                        values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002',
                                'Cash', 'CASH', '00000000-0000-0000-0000-000000000003')
                        """);
                sql.execute("""
                        insert into asset (id, book_id, asset_type_id, ownership_scope, owner_member_id,
                                           name, opened_on, balance_anchor_won, created_by_member_id, updated_by_member_id)
                        values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002',
                                '00000000-0000-0000-0000-000000000004', 'JOINT', null,
                                'Legacy asset', '2026-01-01', 12345,
                                '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003')
                        """);
                if (archived) {
                    sql.execute("update asset set archived_at = now(), "
                            + "archived_by_member_id = '00000000-0000-0000-0000-000000000003'");
                }

                Flyway latest = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load();
                assertThatThrownBy(latest::migrate).isInstanceOf(FlywayException.class)
                        .hasStackTraceContaining("Individual asset owners must be assigned before applying V29");
                try (var rows = sql.executeQuery("select ownership_scope, owner_member_id, balance_anchor_won, archived_at from asset")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo("JOINT");
                    assertThat(rows.getObject(2)).isNull();
                    assertThat(rows.getLong(3)).isEqualTo(12345);
                    assertThat(rows.getObject(4) != null).isEqualTo(archived);
                }

                // Explicit fixture assignment models the operator correcting the old data before retrying.
                sql.execute("update asset set ownership_scope = 'PERSONAL', "
                        + "owner_member_id = '00000000-0000-0000-0000-000000000003'");
                latest.migrate();
                try (var rows = sql.executeQuery("select owner_member_id, current_balance_won from asset join asset_current_balance on asset.id = asset_id")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo("00000000-0000-0000-0000-000000000003");
                    assertThat(rows.getLong(2)).isEqualTo(12345);
                }
                assertThatThrownBy(() -> sql.execute("update asset set ownership_scope = 'JOINT'"))
                        .isInstanceOf(SQLException.class);
                assertThatThrownBy(() -> sql.execute("update asset set owner_member_id = null"))
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
}
