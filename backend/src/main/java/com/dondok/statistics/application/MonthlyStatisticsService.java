package com.dondok.statistics.application;

import com.dondok.category.infrastructure.persistence.CategoryRepository;
import com.dondok.common.error.ApiException;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import com.dondok.statistics.domain.AssetOwnerFilter;
import com.dondok.statistics.infrastructure.persistence.StatisticsJdbcRepository;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MonthlyStatisticsService {
    private final StatisticsJdbcRepository statistics;
    private final LedgerMemberRepository members;
    private final CategoryRepository categories;

    public MonthlyStatisticsService(
            StatisticsJdbcRepository statistics,
            LedgerMemberRepository members,
            CategoryRepository categories
    ) {
        this.statistics = statistics;
        this.members = members;
        this.categories = categories;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MonthlyStatistics monthly(
            UUID userId,
            YearMonth month,
            UUID performedByMemberId,
            AssetOwnerFilter.Type assetOwnerType,
            UUID assetOwnerMemberId,
            UUID categoryId
    ) {
        LedgerMemberEntity currentMember = members.findByUserId(userId)
                .orElseThrow(this::ledgerNotFound);
        AssetOwnerFilter assetOwner = requireAssetOwnerFilter(assetOwnerType, assetOwnerMemberId);
        requireMember(currentMember.getBookId(), performedByMemberId);
        if (assetOwner.type() == AssetOwnerFilter.Type.MEMBER) {
            requireMember(currentMember.getBookId(), assetOwner.memberId());
        }
        if (categoryId != null && categories.findByIdAndBookIdAndArchivedAtIsNull(
                categoryId, currentMember.getBookId()).isEmpty()) {
            throw error(HttpStatus.BAD_REQUEST, "STATISTICS_CATEGORY_INVALID",
                    "현재 가계부에서 사용할 수 있는 분류를 선택해 주세요.");
        }

        LocalDate periodStart = month.atDay(1);
        LocalDate periodEndExclusive = month.plusMonths(1).atDay(1);
        StatisticsJdbcRepository.MonthlyAggregation aggregation = statistics.monthly(
                currentMember.getBookId(), periodStart, periodEndExclusive,
                performedByMemberId, assetOwner, categoryId);
        LocalDate yearStart = month.withMonth(1).atDay(1);
        LocalDate nextYearStart = yearStart.plusYears(1);
        Map<YearMonth, StatisticsJdbcRepository.MonthAmount> amountsByMonth =
                statistics.yearly(
                                currentMember.getBookId(), yearStart, nextYearStart,
                                performedByMemberId, assetOwner, categoryId)
                        .stream()
                        .collect(Collectors.toMap(
                                StatisticsJdbcRepository.MonthAmount::month, Function.identity()));
        List<MonthSummary> yearlyTrend = IntStream.rangeClosed(1, 12)
                .mapToObj(monthNumber -> {
                    YearMonth trendMonth = month.withMonth(monthNumber);
                    StatisticsJdbcRepository.MonthAmount amount = amountsByMonth.get(trendMonth);
                    long income = amount == null ? 0 : amount.incomeWon();
                    long expense = amount == null ? 0 : amount.expenseWon();
                    return new MonthSummary(trendMonth, income, expense, income - expense);
                })
                .toList();
        List<CategoryAmount> categoryBreakdown = aggregation.categoryAmounts().stream()
                .sorted(Comparator
                        .comparing(StatisticsJdbcRepository.CategoryAmount::kind)
                        .thenComparing(StatisticsJdbcRepository.CategoryAmount::amountWon,
                                Comparator.reverseOrder())
                        .thenComparing(StatisticsJdbcRepository.CategoryAmount::categoryName)
                        .thenComparing(StatisticsJdbcRepository.CategoryAmount::categoryId))
                .map(row -> new CategoryAmount(
                        row.categoryId(), row.categoryName(), row.kind().name(), row.amountWon()))
                .toList();
        StatisticsJdbcRepository.Totals totals = aggregation.totals();
        return new MonthlyStatistics(
                month, periodStart, periodEndExclusive,
                new AppliedFilters(performedByMemberId, assetOwner.type(), assetOwner.memberId(), categoryId),
                new Totals(totals.incomeWon(), totals.expenseWon(),
                        totals.incomeWon() - totals.expenseWon()),
                categoryBreakdown, yearlyTrend, List.of());
    }

    private AssetOwnerFilter requireAssetOwnerFilter(
            AssetOwnerFilter.Type requestedType,
            UUID memberId
    ) {
        AssetOwnerFilter.Type type = requestedType == null
                ? AssetOwnerFilter.Type.ALL
                : requestedType;
        boolean valid = type == AssetOwnerFilter.Type.MEMBER
                ? memberId != null
                : memberId == null;
        if (!valid) {
            throw error(HttpStatus.BAD_REQUEST, "STATISTICS_FILTER_INVALID",
                    "자산 소유자 필터를 확인해 주세요.");
        }
        return new AssetOwnerFilter(type, memberId);
    }

    private void requireMember(UUID bookId, UUID memberId) {
        if (memberId != null && members.findByIdAndBookId(memberId, bookId).isEmpty()) {
            throw error(HttpStatus.BAD_REQUEST, "STATISTICS_MEMBER_INVALID",
                    "현재 가계부의 구성원을 선택해 주세요.");
        }
    }

    private ApiException ledgerNotFound() {
        return error(HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다.");
    }

    private ApiException error(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message);
    }

    public record MonthlyStatistics(
            YearMonth month,
            LocalDate periodStart,
            LocalDate periodEndExclusive,
            AppliedFilters appliedFilters,
            Totals totals,
            List<CategoryAmount> categoryBreakdown,
            List<MonthSummary> yearlyTrend,
            List<DaySummary> dailyTrend
    ) {
    }

    public record AppliedFilters(
            UUID performedByMemberId,
            AssetOwnerFilter.Type assetOwnerType,
            UUID assetOwnerMemberId,
            UUID categoryId
    ) {
    }

    public record Totals(long incomeWon, long expenseWon, long netWon) {
    }

    public record CategoryAmount(UUID categoryId, String categoryName, String kind, long amountWon) {
    }

    public record MonthSummary(YearMonth month, long incomeWon, long expenseWon, long netWon) {
    }

    public record DaySummary(LocalDate date, long incomeWon, long expenseWon, long netWon) {
    }
}
