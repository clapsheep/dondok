package com.dondok.statistics.infrastructure.persistence;

import com.dondok.category.domain.CategoryKind;
import com.dondok.statistics.domain.AssetOwnerFilter;
import java.sql.Date;
import java.sql.Timestamp;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class StatisticsJdbcRepository {
    private final JdbcTemplate jdbcTemplate;

    public StatisticsJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public MonthlyAggregation monthly(
            UUID bookId,
            LocalDate from,
            LocalDate toExclusive,
            UUID performedByMemberId,
            AssetOwnerFilter assetOwner,
            UUID categoryId
    ) {
        QueryParts query = queryParts(
                bookId, from, toExclusive, performedByMemberId, assetOwner, categoryId);

        String sql = """
                with filtered_activity as (
                    select activity.transaction_type,
                           activity.category_id,
                           category.name category_name,
                           activity.statistics_amount_won
                      from ledger_financial_activity activity
                      join category
                        on category.book_id = activity.book_id
                       and category.id = activity.category_id
                """ + query.joins() + """
                     where activity.book_id = ?
                       and activity.occurred_on >= ?
                       and activity.occurred_on < ?
                """ + query.filters() + """
                )
                select case
                           when grouping(transaction_type) = 0 then 'CATEGORY'
                           else 'TOTAL'
                       end row_type,
                       transaction_type,
                       category_id,
                       category_name,
                       coalesce(sum(statistics_amount_won)
                           filter (where transaction_type = 'INCOME'), 0) income_won,
                       coalesce(sum(statistics_amount_won)
                           filter (where transaction_type = 'EXPENSE'), 0) expense_won,
                       coalesce(sum(statistics_amount_won), 0) amount_won
                 from filtered_activity
                 group by grouping sets (
                     (),
                     (transaction_type, category_id, category_name)
                 )
                """;

        List<AggregationRow> rows = jdbcTemplate.query(sql, (resultSet, rowNumber) ->
                new AggregationRow(
                        RowType.valueOf(resultSet.getString("row_type")),
                        resultSet.getString("transaction_type") == null
                                ? null
                                : CategoryKind.valueOf(resultSet.getString("transaction_type")),
                        resultSet.getObject("category_id", UUID.class),
                        resultSet.getString("category_name"),
                        resultSet.getLong("income_won"),
                        resultSet.getLong("expense_won"),
                        resultSet.getLong("amount_won")),
                query.arguments().toArray());

        Totals totals = rows.stream()
                .filter(row -> row.type() == RowType.TOTAL)
                .findFirst()
                .map(row -> new Totals(row.incomeWon(), row.expenseWon()))
                .orElseGet(() -> new Totals(0, 0));
        List<CategoryAmount> categoryAmounts = rows.stream()
                .filter(row -> row.type() == RowType.CATEGORY && row.amountWon() != 0)
                .map(row -> new CategoryAmount(
                        row.categoryId(), row.categoryName(), row.kind(), row.amountWon()))
                .toList();
        return new MonthlyAggregation(totals, categoryAmounts);
    }

    public List<MonthAmount> yearly(
            UUID bookId,
            LocalDate from,
            LocalDate toExclusive,
            UUID performedByMemberId,
            AssetOwnerFilter assetOwner,
            UUID categoryId
    ) {
        QueryParts query = queryParts(
                bookId, from, toExclusive, performedByMemberId, assetOwner, categoryId);
        String sql = """
                select date_trunc('month', activity.occurred_on)::date month_start,
                       coalesce(sum(activity.statistics_amount_won)
                           filter (where activity.transaction_type = 'INCOME'), 0) income_won,
                       coalesce(sum(activity.statistics_amount_won)
                           filter (where activity.transaction_type = 'EXPENSE'), 0) expense_won
                  from ledger_financial_activity activity
                """ + query.joins() + """
                 where activity.book_id = ?
                   and activity.occurred_on >= ?
                   and activity.occurred_on < ?
                """ + query.filters() + """
                 group by month_start
                 order by month_start
                """;
        return jdbcTemplate.query(sql, (resultSet, rowNumber) -> new MonthAmount(
                YearMonth.from(resultSet.getObject("month_start", LocalDate.class)),
                resultSet.getLong("income_won"),
                resultSet.getLong("expense_won")), query.arguments().toArray());
    }

    public CategoryTransactionRows categoryTransactions(
            UUID bookId,
            LocalDate from,
            LocalDate toExclusive,
            UUID performedByMemberId,
            AssetOwnerFilter assetOwner,
            UUID categoryId,
            Cursor cursor,
            int limit
    ) {
        QueryParts query = queryParts(
                bookId, from, toExclusive, performedByMemberId, assetOwner, categoryId);
        List<Object> arguments = new ArrayList<>(query.arguments());
        String cursorFilter = "";
        if (cursor != null) {
            cursorFilter = " and (activity.occurred_on, transaction.created_at, activity.transaction_id) < (?, ?, ?)";
            arguments.add(Date.valueOf(cursor.occurredOn()));
            arguments.add(Timestamp.from(cursor.createdAt()));
            arguments.add(cursor.transactionId());
        }
        arguments.add(limit + 1);
        String sql = """
                select activity.transaction_id,
                       activity.occurred_on,
                       transaction.created_at,
                       transaction.transaction_type,
                       case
                           when transaction.transaction_type = 'INCOME'
                               then activity.statistics_amount_won
                           else -activity.statistics_amount_won
                       end statistics_contribution_won,
                       transaction.description,
                       category.name category_name,
                       detail_asset.id asset_id,
                       detail_asset.name asset_name,
                       performer.id performer_id,
                       performer_user.display_name performer_name
                  from ledger_financial_activity activity
                  join ledger_transaction transaction
                    on transaction.book_id = activity.book_id
                   and transaction.id = activity.transaction_id
                  join category
                    on category.book_id = activity.book_id
                   and category.id = activity.category_id
                  join asset detail_asset
                    on detail_asset.book_id = activity.book_id
                   and detail_asset.id = activity.primary_asset_id
                  left join ledger_member performer
                    on performer.book_id = activity.book_id
                   and performer.id = activity.performed_by_member_id
                  left join app_user performer_user on performer_user.id = performer.user_id
                """ + query.joins() + """
                 where activity.book_id = ?
                   and activity.occurred_on >= ?
                   and activity.occurred_on < ?
                """ + query.filters() + cursorFilter + """
                 order by activity.occurred_on desc, transaction.created_at desc,
                          activity.transaction_id desc
                 limit ?
                """;
        List<CategoryTransactionRow> rows = jdbcTemplate.query(sql, (resultSet, rowNumber) ->
                new CategoryTransactionRow(
                        resultSet.getObject("transaction_id", UUID.class),
                        resultSet.getObject("occurred_on", LocalDate.class),
                        resultSet.getTimestamp("created_at").toInstant(),
                        CategoryKind.valueOf(resultSet.getString("transaction_type")),
                        resultSet.getLong("statistics_contribution_won"),
                        resultSet.getString("description"),
                        resultSet.getString("category_name"),
                        resultSet.getObject("asset_id", UUID.class),
                        resultSet.getString("asset_name"),
                        resultSet.getObject("performer_id", UUID.class),
                        resultSet.getString("performer_name")),
                arguments.toArray());
        boolean hasNext = rows.size() > limit;
        List<CategoryTransactionRow> page = hasNext ? rows.subList(0, limit) : rows;
        String nextCursor = hasNext && !page.isEmpty()
                ? Cursor.from(page.get(page.size() - 1)).encode()
                : null;
        return new CategoryTransactionRows(List.copyOf(page), nextCursor);
    }

    private QueryParts queryParts(
            UUID bookId,
            LocalDate from,
            LocalDate toExclusive,
            UUID performedByMemberId,
            AssetOwnerFilter assetOwner,
            UUID categoryId
    ) {
        List<Object> arguments = new ArrayList<>();
        arguments.add(bookId);
        arguments.add(Date.valueOf(from));
        arguments.add(Date.valueOf(toExclusive));

        StringBuilder joins = new StringBuilder();
        StringBuilder filters = new StringBuilder();
        if (performedByMemberId != null) {
            filters.append(" and activity.performed_by_member_id = ?");
            arguments.add(performedByMemberId);
        }
        if (categoryId != null) {
            filters.append(" and activity.category_id = ?");
            arguments.add(categoryId);
        }
        if (assetOwner.type() != AssetOwnerFilter.Type.ALL) {
            joins.append(" join asset selected_asset")
                    .append(" on selected_asset.book_id = activity.book_id")
                    .append(" and selected_asset.id = activity.primary_asset_id");
            filters.append(" and selected_asset.owner_member_id = ?");
            arguments.add(assetOwner.memberId());
        }
        return new QueryParts(joins.toString(), filters.toString(), arguments);
    }

    private enum RowType {
        TOTAL,
        CATEGORY
    }

    private record AggregationRow(
            RowType type,
            CategoryKind kind,
            UUID categoryId,
            String categoryName,
            long incomeWon,
            long expenseWon,
            long amountWon
    ) {
    }

    public record MonthlyAggregation(
            Totals totals,
            List<CategoryAmount> categoryAmounts
    ) {
    }

    public record Totals(long incomeWon, long expenseWon) {
    }

    public record MonthAmount(YearMonth month, long incomeWon, long expenseWon) {
    }

    public record CategoryAmount(UUID categoryId, String categoryName, CategoryKind kind, long amountWon) {
    }

    public record CategoryTransactionRow(
            UUID transactionId,
            LocalDate occurredOn,
            Instant createdAt,
            CategoryKind kind,
            long statisticsContributionWon,
            String description,
            String categoryName,
            UUID assetId,
            String assetName,
            UUID performerId,
            String performerName
    ) {
    }

    public record CategoryTransactionRows(List<CategoryTransactionRow> items, String nextCursor) {
    }

    public record Cursor(LocalDate occurredOn, Instant createdAt, UUID transactionId) {
        public static Cursor decode(String encoded) {
            if (encoded == null || encoded.isBlank()) {
                return null;
            }
            String raw = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            String[] parts = raw.split("\\|", -1);
            if (parts.length != 3) {
                throw new IllegalArgumentException("invalid statistics transaction cursor");
            }
            return new Cursor(LocalDate.parse(parts[0]), Instant.parse(parts[1]), UUID.fromString(parts[2]));
        }

        private static Cursor from(CategoryTransactionRow row) {
            return new Cursor(row.occurredOn(), row.createdAt(), row.transactionId());
        }

        private String encode() {
            String raw = occurredOn + "|" + createdAt + "|" + transactionId;
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        }
    }

    private record QueryParts(String joins, String filters, List<Object> arguments) {
    }
}
