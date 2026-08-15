package com.dondok.asset.api;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.asset.domain.CardIssuerCode;
import com.dondok.asset.domain.FinancialInstitutionCode;
import com.dondok.auth.application.DondokPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
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

@Validated
@RestController
@RequestMapping("/api")
public class AssetController {

    private final AssetService assetService;

    public AssetController(AssetService assetService) {
        this.assetService = assetService;
    }

    @GetMapping("/asset-types")
    List<AssetService.AssetTypeView> assetTypes(
            @AuthenticationPrincipal DondokPrincipal principal
    ) {
        return assetService.assetTypes(principal.userId());
    }

    @GetMapping("/assets")
    List<AssetService.AssetView> assets(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestParam(defaultValue = "ACTIVE") AssetService.AssetListStatus status
    ) {
        return assetService.assets(principal.userId(), status);
    }

    @GetMapping("/assets/{assetId}")
    AssetService.AssetView asset(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID assetId
    ) {
        return assetService.asset(principal.userId(), assetId);
    }

    @PostMapping("/assets")
    @ResponseStatus(HttpStatus.CREATED)
    AssetService.AssetView createAsset(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max = 100) String idempotencyKey,
            @Valid @RequestBody CreateAssetRequest request
    ) {
        return assetService.create(principal.userId(), idempotencyKey, request.toCommand());
    }

    @PutMapping("/assets/{assetId}")
    AssetService.AssetView updateAsset(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID assetId,
            @Valid @RequestBody UpdateAssetRequest request
    ) {
        return assetService.update(principal.userId(), assetId, new AssetService.UpdateAssetCommand(
                request.toCommand(), request.expectedVersion(), request.reassignTransactionsToNewOwner()));
    }

    @GetMapping("/assets/{assetId}/removal-preview")
    AssetService.AssetRemovalPreview previewAssetRemoval(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID assetId
    ) {
        return assetService.removalPreview(principal.userId(), assetId);
    }

    @DeleteMapping("/assets/{assetId}")
    AssetService.AssetRemovalResult removeAsset(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID assetId,
            @RequestParam @Min(0) long expectedVersion,
            @RequestParam @NotBlank @Size(min = 64, max = 64) String previewToken
    ) {
        return assetService.remove(principal.userId(), assetId, expectedVersion, previewToken);
    }

    @PostMapping("/assets/{assetId}/restore")
    AssetService.AssetView restoreAsset(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID assetId,
            @Valid @RequestBody RestoreAssetRequest request
    ) {
        return assetService.restore(principal.userId(), assetId, request.expectedVersion());
    }

    private interface AssetPayload {
        UUID assetTypeId();

        AssetOwnershipScope ownershipScope();

        UUID ownerMemberId();

        FinancialInstitutionCode financialInstitutionCode();

        CardIssuerCode cardIssuerCode();

        String name();

        LocalDate openedOn();

        String memo();

        Long openingBalanceWon();

        CardSettingsRequest cardSettings();

        DebitCardSettingsRequest debitCardSettings();

        SavingsSettingsRequest savingsSettings();

        default AssetService.AssetCommand toCommand() {
            return new AssetService.AssetCommand(
                    assetTypeId(), ownershipScope(), ownerMemberId(), financialInstitutionCode(), cardIssuerCode(), name(),
                    openedOn(), memo(), openingBalanceWon(),
                    cardSettings() == null ? null : cardSettings().toCommand(),
                    debitCardSettings() == null ? null : debitCardSettings().toCommand(),
                    savingsSettings() == null ? null : savingsSettings().toCommand());
        }
    }

    public record RestoreAssetRequest(@Min(0) long expectedVersion) {
    }

    public record CreateAssetRequest(
            @NotNull UUID assetTypeId,
            @NotNull AssetOwnershipScope ownershipScope,
            UUID ownerMemberId,
            FinancialInstitutionCode financialInstitutionCode,
            CardIssuerCode cardIssuerCode,
            @NotBlank @Size(max = 100) String name,
            @NotNull LocalDate openedOn,
            @Size(max = 1000) String memo,
            @NotNull Long openingBalanceWon,
            @Valid CardSettingsRequest cardSettings,
            @Valid DebitCardSettingsRequest debitCardSettings,
            @Valid SavingsSettingsRequest savingsSettings
    ) implements AssetPayload {
    }

    public record UpdateAssetRequest(
            @NotNull UUID assetTypeId,
            @NotNull AssetOwnershipScope ownershipScope,
            UUID ownerMemberId,
            FinancialInstitutionCode financialInstitutionCode,
            CardIssuerCode cardIssuerCode,
            @NotBlank @Size(max = 100) String name,
            @NotNull LocalDate openedOn,
            @Size(max = 1000) String memo,
            @NotNull Long openingBalanceWon,
            @Valid CardSettingsRequest cardSettings,
            @Valid DebitCardSettingsRequest debitCardSettings,
            @Valid SavingsSettingsRequest savingsSettings,
            @NotNull @Min(0) Long expectedVersion,
            @NotNull Boolean reassignTransactionsToNewOwner
    ) implements AssetPayload {
    }

    public record CardSettingsRequest(
            @NotNull @Min(1) @Max(31) Integer statementClosingDay,
            @NotNull @Min(1) @Max(31) Integer paymentDay,
            @NotNull @Min(0) @Max(2) Integer paymentMonthOffset,
            UUID settlementAssetId,
            @NotNull Boolean autoSettlementEnabled
    ) {
        AssetService.CardSettingsCommand toCommand() {
            return new AssetService.CardSettingsCommand(
                    statementClosingDay, paymentDay, paymentMonthOffset,
                    settlementAssetId, autoSettlementEnabled);
        }
    }

    public record DebitCardSettingsRequest(
            @NotNull UUID paymentAssetId
    ) {
        AssetService.DebitCardSettingsCommand toCommand() {
            return new AssetService.DebitCardSettingsCommand(paymentAssetId);
        }
    }

    public record SavingsSettingsRequest(
            @NotNull UUID transferAssetId,
            @NotNull @Min(1) @Max(31) Integer transferDay
    ) {
        AssetService.SavingsSettingsCommand toCommand() {
            return new AssetService.SavingsSettingsCommand(transferAssetId, transferDay);
        }
    }
}
