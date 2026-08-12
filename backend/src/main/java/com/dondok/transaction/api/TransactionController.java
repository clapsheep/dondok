package com.dondok.transaction.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.common.error.ApiException;
import com.dondok.transaction.application.TransactionService;
import com.dondok.transaction.domain.TransactionType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/transactions")
public class TransactionController {
    private final TransactionService transactionService;

    public TransactionController(TransactionService transactionService) {
        this.transactionService = transactionService;
    }

    @GetMapping("/calendar")
    TransactionService.CalendarView calendar(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestParam YearMonth month,
            @RequestParam(required = false) UUID performedByMemberId
    ) {
        return transactionService.calendar(principal.userId(), month, performedByMemberId);
    }

    @GetMapping
    TransactionService.TransactionPage transactions(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestParam LocalDate from,
            @RequestParam LocalDate toExclusive,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) UUID performedByMemberId
    ) {
        return transactionService.transactions(
                principal.userId(), from, toExclusive, cursor, limit, performedByMemberId);
    }

    @GetMapping("/{transactionId}")
    TransactionService.TransactionView transaction(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID transactionId
    ) {
        return transactionService.transaction(principal.userId(), transactionId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    TransactionService.TransactionView create(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max = 100) String idempotencyKey,
            @Valid @RequestBody CreateTransactionRequest request
    ) {
        return transactionService.create(principal.userId(), idempotencyKey, request.toCommand());
    }

    @PutMapping("/{transactionId}")
    TransactionService.TransactionView update(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID transactionId,
            @Valid @RequestBody UpdateTransactionRequest request
    ) {
        return transactionService.update(principal.userId(), transactionId, request.toCommand());
    }

    @DeleteMapping("/{transactionId}")
    TransactionService.DeletedTransactionView delete(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID transactionId,
            @RequestParam @Min(0) long expectedVersion
    ) {
        return transactionService.delete(principal.userId(), transactionId, expectedVersion);
    }

    public record CreateTransactionRequest(
            @NotNull TransactionType type,
            @NotNull LocalDate occurredOn,
            @Positive long amountWon,
            UUID categoryId,
            UUID assetId,
            UUID sourceAssetId,
            UUID destinationAssetId,
            @NotNull UUID performedByMemberId,
            @Size(max = 500) String description,
            Integer installmentCount,
            Boolean excludedFromStatistics
    ) {
        TransactionService.CreateCommand toCommand() {
            boolean statisticsExcluded = Boolean.TRUE.equals(excludedFromStatistics);
            return switch (type) {
                case INCOME -> {
                    require(categoryId != null && assetId != null
                            && sourceAssetId == null && destinationAssetId == null
                            && installmentCount == null);
                    yield new TransactionService.CreateIncome(
                            occurredOn, amountWon, categoryId, assetId, performedByMemberId,
                            description, statisticsExcluded);
                }
                case EXPENSE -> {
                    require(categoryId != null && assetId != null
                            && sourceAssetId == null && destinationAssetId == null);
                    yield new TransactionService.CreateExpense(
                            occurredOn, amountWon, categoryId, assetId, performedByMemberId,
                            description, installmentCount == null ? 1 : installmentCount,
                            statisticsExcluded);
                }
                case TRANSFER -> {
                    require(categoryId == null && assetId == null && installmentCount == null
                            && sourceAssetId != null && destinationAssetId != null
                            && !statisticsExcluded);
                    yield new TransactionService.CreateTransfer(
                            occurredOn, amountWon, sourceAssetId, destinationAssetId,
                            performedByMemberId, description);
                }
            };
        }

        private void require(boolean valid) {
            if (!valid) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                        "거래 유형에 맞는 입력값을 확인해 주세요.");
            }
        }
    }

    public record UpdateTransactionRequest(
            @NotNull TransactionType type,
            @NotNull LocalDate occurredOn,
            @Positive long amountWon,
            UUID categoryId,
            UUID assetId,
            UUID sourceAssetId,
            UUID destinationAssetId,
            @NotNull UUID performedByMemberId,
            @Size(max = 500) String description,
            Integer installmentCount,
            @NotNull @Min(0) Long expectedVersion,
            Boolean excludedFromStatistics
    ) {
        TransactionService.UpdateCommand toCommand() {
            if (type != TransactionType.EXPENSE && installmentCount != null) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                        "거래 유형에 맞는 입력값을 확인해 주세요.");
            }
            return new TransactionService.UpdateCommand(
                    type, occurredOn, amountWon, categoryId, assetId, sourceAssetId,
                    destinationAssetId, performedByMemberId, description, expectedVersion,
                    Boolean.TRUE.equals(excludedFromStatistics),
                    installmentCount == null ? 1 : installmentCount);
        }
    }
}
