package com.dondok.statistics.infrastructure.persistence;

import com.dondok.category.domain.CategoryKind;
import com.dondok.statistics.domain.AssetOwnerFilter;
import java.sql.Date;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
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
            if (assetOwner.type() == AssetOwnerFilter.Type.JOINT) {
                filters.append(" and selected_asset.ownership_scope = 'JOINT'");
            } else {
                filters.append(" and selected_asset.ownership_scope = 'PERSONAL'")
                        .append(" and selected_asset.owner_member_id = ?");
                arguments.add(assetOwner.memberId());
            }
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

    private record QueryParts(String joins, String filters, List<Object> arguments) {
    }
}
