package com.dondok.asset.application;

import com.dondok.common.error.ApiException;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Money connections depend on asset name-holders, never on the editor or performer. */
@Component
public class AssetConnectionPolicy {
    private final JdbcTemplate jdbc;
    public AssetConnectionPolicy(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void requireSameOwner(UUID book, UUID source, UUID destination) {
        requireOwner(book, owner(book, source), destination);
    }

    public void requireOwner(UUID book, UUID owner, UUID linkedAsset) {
        if (linkedAsset != null && !Objects.equals(owner, owner(book, linkedAsset))) throw invalid();
    }

    public void requireIncomingOwners(UUID book, UUID asset, UUID newOwner) {
        Boolean incompatible = jdbc.queryForObject("""
                select exists (
                  select 1 from asset a join (
                    select card_asset_id as id from card_setting where book_id = ? and settlement_asset_id = ?
                    union select debit_card_asset_id from debit_card_setting where book_id = ? and payment_asset_id = ?
                    union select savings_asset_id from savings_setting where book_id = ? and transfer_asset_id = ?
                  ) linked on linked.id = a.id
                  where a.owner_member_id <> ?
                )
                """, Boolean.class, book, asset, book, asset, book, asset, newOwner);
        if (Boolean.TRUE.equals(incompatible)) throw invalid();
    }

    private UUID owner(UUID book, UUID asset) {
        return jdbc.query("select owner_member_id from asset where book_id = ? and id = ?",
                (rs, row) -> rs.getObject(1, UUID.class), book, asset).stream().findFirst().orElseThrow(this::invalid);
    }

    private ApiException invalid() {
        return new ApiException(HttpStatus.BAD_REQUEST, "CROSS_MEMBER_ASSET_CONNECTION_NOT_ALLOWED",
                "같은 명의의 자산만 연결할 수 있어요. 사람 간 송금은 각자의 수입·지출로 기록해 주세요.");
    }
}
