package com.dondok.statistics.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.statistics.application.MonthlyStatisticsService;
import com.dondok.statistics.domain.AssetOwnerFilter;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.YearMonth;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/statistics")
public class StatisticsController {
    private final MonthlyStatisticsService statisticsService;

    public StatisticsController(MonthlyStatisticsService statisticsService) {
        this.statisticsService = statisticsService;
    }

    @GetMapping("/monthly")
    MonthlyStatisticsService.MonthlyStatistics monthly(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestParam YearMonth month,
            @RequestParam(required = false) UUID performedByMemberId,
            @RequestParam(defaultValue = "ALL") AssetOwnerFilter.Type assetOwnerType,
            @RequestParam(required = false) UUID assetOwnerMemberId,
            @RequestParam(required = false) UUID categoryId
    ) {
        return statisticsService.monthly(
                principal.userId(), month, performedByMemberId,
                assetOwnerType, assetOwnerMemberId, categoryId);
    }

    @GetMapping("/monthly/categories/{categoryId}/transactions")
    MonthlyStatisticsService.CategoryTransactionPage categoryTransactions(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID categoryId,
            @RequestParam YearMonth month,
            @RequestParam(required = false) UUID performedByMemberId,
            @RequestParam(defaultValue = "ALL") AssetOwnerFilter.Type assetOwnerType,
            @RequestParam(required = false) UUID assetOwnerMemberId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "30") @Min(1) @Max(100) int limit
    ) {
        return statisticsService.categoryTransactions(
                principal.userId(), month, performedByMemberId,
                assetOwnerType, assetOwnerMemberId, categoryId, cursor, limit);
    }
}
