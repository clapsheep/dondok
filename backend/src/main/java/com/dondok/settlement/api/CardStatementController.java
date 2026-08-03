package com.dondok.settlement.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.settlement.application.CardStatementService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api")
public class CardStatementController {
    private final CardStatementService service;

    public CardStatementController(CardStatementService service) {
        this.service = service;
    }

    @GetMapping("/assets/{cardAssetId}/card-statements")
    CardStatementService.CardStatementPage statements(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID cardAssetId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int limit,
            @RequestParam(defaultValue = "false") boolean includePaid
    ) {
        return service.statements(
                principal.userId(), cardAssetId, cursor, limit, includePaid);
    }

    @GetMapping("/card-statements/{statementId}")
    CardStatementService.CardStatementDetail statement(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID statementId
    ) {
        return service.statement(principal.userId(), statementId);
    }

    @PostMapping("/card-statements/{statementId}/prepayments/preview")
    CardStatementService.CardStatementPrepaymentPreview preview(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID statementId,
            @Valid @RequestBody PrepaymentPreviewRequest request
    ) {
        return service.preview(principal.userId(), statementId, request.toCommand());
    }

    @PostMapping("/card-statements/{statementId}/prepayments")
    @ResponseStatus(HttpStatus.CREATED)
    CardStatementService.CardStatementPaymentResult prepay(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID statementId,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max = 100) String idempotencyKey,
            @Valid @RequestBody PrepaymentApplyRequest request
    ) {
        return service.prepay(
                principal.userId(), statementId, idempotencyKey, request.toCommand());
    }

    public record PrepaymentPreviewRequest(
            @Positive long amountWon,
            @Min(0) long expectedVersion
    ) {
        CardStatementService.PrepaymentCommand toCommand() {
            return new CardStatementService.PrepaymentCommand(amountWon, expectedVersion);
        }
    }

    public record PrepaymentApplyRequest(
            @Positive long amountWon,
            @Min(0) long expectedVersion,
            @NotBlank @Size(max = 64) String previewToken
    ) {
        CardStatementService.PrepaymentApplyCommand toCommand() {
            return new CardStatementService.PrepaymentApplyCommand(
                    amountWon, expectedVersion, previewToken);
        }
    }
}
