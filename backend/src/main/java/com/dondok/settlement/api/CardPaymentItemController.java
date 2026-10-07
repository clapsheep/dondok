package com.dondok.settlement.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.settlement.application.CardPaymentItemService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Validated
@RestController
@RequestMapping("/api/assets/{cardAssetId}")
public class CardPaymentItemController {
    private final CardPaymentItemService service;
    public CardPaymentItemController(CardPaymentItemService service) { this.service = service; }
    @GetMapping("/card-payment-items")
    CardPaymentItemService.Page list(@AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID cardAssetId, @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "30") @Min(1) @Max(50) int limit) {
        return service.list(principal.userId(), cardAssetId, cursor, limit);
    }
    @PostMapping("/card-payments")
    @ResponseStatus(HttpStatus.CREATED)
    CardPaymentItemService.Result pay(@AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID cardAssetId,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max = 100) String key,
            @Valid @RequestBody PaymentRequest request) {
        return service.pay(principal.userId(), cardAssetId, key, new CardPaymentItemService.Command(
                request.snapshotToken(), request.mode(), request.baseSelection(), request.includedChargeIds(),
                request.excludedChargeIds(), request.amountWon(), request.settlementAssetId(), request.paidOn()));
    }
    public record PaymentRequest(@NotBlank @Size(max = 100) String snapshotToken,
            @NotNull @Pattern(regexp = "SELECTED|AMOUNT") String mode,
            @NotNull @Pattern(regexp = "CLOSED|ALL|NONE") String baseSelection,
            @NotNull @Size(max = 5000) List<@NotNull UUID> includedChargeIds,
            @NotNull @Size(max = 5000) List<@NotNull UUID> excludedChargeIds,
            @Positive Long amountWon, @NotNull UUID settlementAssetId, @NotNull LocalDate paidOn) {}
}
