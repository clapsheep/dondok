package com.dondok.transaction.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.transaction.application.CardPurchaseManagementService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/transactions/{purchaseId}")
public class CardPurchaseManagementController {
    private final CardPurchaseManagementService service;

    public CardPurchaseManagementController(CardPurchaseManagementService service) {
        this.service = service;
    }

    @GetMapping("/card-purchase-management")
    CardPurchaseManagementService.CardPurchaseManagementView management(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID purchaseId
    ) {
        return service.management(principal.userId(), purchaseId);
    }

    @PostMapping("/card-purchase-refunds/preview")
    CardPurchaseManagementService.CardPurchaseRefundPreview previewRefund(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID purchaseId,
            @Valid @RequestBody CardPurchaseRefundPreviewRequest request
    ) {
        return service.previewRefund(principal.userId(), purchaseId, request.toCommand());
    }

    @PostMapping("/card-purchase-refunds")
    @ResponseStatus(HttpStatus.CREATED)
    CardPurchaseManagementService.CardPurchaseRefundResult refund(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID purchaseId,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max = 100) String idempotencyKey,
            @Valid @RequestBody CardPurchaseRefundApplyRequest request
    ) {
        return service.refund(principal.userId(), purchaseId, idempotencyKey, request.toCommand());
    }

    @PostMapping("/card-purchase-corrections/preview")
    CardPurchaseManagementService.CardPurchaseCorrectionPreview previewCorrection(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID purchaseId,
            @Valid @RequestBody CardPurchaseCorrectionPreviewRequest request
    ) {
        return service.previewCorrection(principal.userId(), purchaseId, request.toCommand());
    }

    @PostMapping("/card-purchase-corrections")
    CardPurchaseManagementService.CardPurchaseManagementView correct(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID purchaseId,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max = 100) String idempotencyKey,
            @Valid @RequestBody CardPurchaseCorrectionApplyRequest request
    ) {
        return service.correct(principal.userId(), purchaseId, idempotencyKey, request.toCommand());
    }

    public record CardPurchaseRefundPreviewRequest(
            @NotNull LocalDate refundedOn,
            @Positive long amountWon,
            @Min(0) long expectedVersion,
            @Size(max = 500) String description,
            Boolean excludedFromStatistics
    ) {
        CardPurchaseManagementService.RefundCommand toCommand() {
            return new CardPurchaseManagementService.RefundCommand(
                    refundedOn, amountWon, expectedVersion, description,
                    Boolean.TRUE.equals(excludedFromStatistics));
        }
    }

    public record CardPurchaseRefundApplyRequest(
            @NotNull LocalDate refundedOn,
            @Positive long amountWon,
            @Min(0) long expectedVersion,
            @Size(max = 500) String description,
            @NotBlank @Size(max = 64) String previewToken,
            Boolean excludedFromStatistics
    ) {
        CardPurchaseManagementService.RefundApplyCommand toCommand() {
            return new CardPurchaseManagementService.RefundApplyCommand(
                    refundedOn, amountWon, expectedVersion, description, previewToken,
                    Boolean.TRUE.equals(excludedFromStatistics));
        }
    }

    public record CardPurchaseCorrectionPreviewRequest(
            @NotNull LocalDate occurredOn,
            @Positive long amountWon,
            @NotNull UUID categoryId,
            @NotNull UUID cardAssetId,
            @NotNull UUID performedByMemberId,
            @Size(max = 500) String description,
            @Min(1) int installmentCount,
            @Min(0) long expectedVersion,
            Boolean excludedFromStatistics
    ) {
        CardPurchaseManagementService.CorrectionCommand toCommand() {
            return new CardPurchaseManagementService.CorrectionCommand(
                    occurredOn, amountWon, categoryId, cardAssetId, performedByMemberId,
                    description, installmentCount, expectedVersion,
                    Boolean.TRUE.equals(excludedFromStatistics));
        }
    }

    public record CardPurchaseCorrectionApplyRequest(
            @NotNull LocalDate occurredOn,
            @Positive long amountWon,
            @NotNull UUID categoryId,
            @NotNull UUID cardAssetId,
            @NotNull UUID performedByMemberId,
            @Size(max = 500) String description,
            @Min(1) int installmentCount,
            @Min(0) long expectedVersion,
            @NotBlank @Size(max = 64) String previewToken,
            Boolean excludedFromStatistics
    ) {
        CardPurchaseManagementService.CorrectionApplyCommand toCommand() {
            return new CardPurchaseManagementService.CorrectionApplyCommand(
                    occurredOn, amountWon, categoryId, cardAssetId, performedByMemberId,
                    description, installmentCount, expectedVersion, previewToken,
                    Boolean.TRUE.equals(excludedFromStatistics));
        }
    }
}
