package com.dondok.transaction.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.transaction.application.TransactionService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import com.dondok.transaction.domain.TransactionType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/assets/{assetId}/transactions")
public class AssetTransactionController {
    private final TransactionService transactionService;

    public AssetTransactionController(TransactionService transactionService) {
        this.transactionService = transactionService;
    }

    @GetMapping
    TransactionService.TransactionPage transactions(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID assetId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "30") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toExclusive,
            @RequestParam(required = false) TransactionType type,
            @RequestParam(required = false) UUID performedByMemberId
    ) {
        return transactionService.transactionsForAsset(
                principal.userId(), assetId, cursor, limit, q, from, toExclusive, type, performedByMemberId);
    }
}
