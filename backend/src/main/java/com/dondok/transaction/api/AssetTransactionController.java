package com.dondok.transaction.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.transaction.application.TransactionService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
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
            @RequestParam(defaultValue = "30") @Min(1) @Max(100) int limit
    ) {
        return transactionService.transactionsForAsset(
                principal.userId(), assetId, cursor, limit);
    }
}
