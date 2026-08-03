package com.dondok.membership.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.membership.application.MembershipService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class MembershipController {

    private final MembershipService membershipService;

    public MembershipController(MembershipService membershipService) {
        this.membershipService = membershipService;
    }

    @GetMapping("/ledger-books/current")
    MembershipService.CurrentLedgerBook currentLedgerBook(
            @AuthenticationPrincipal DondokPrincipal principal
    ) {
        return membershipService.currentLedgerBook(principal.userId());
    }

    @PostMapping("/ledger-books")
    @ResponseStatus(HttpStatus.CREATED)
    MembershipService.LedgerBookView createLedgerBook(
            @AuthenticationPrincipal DondokPrincipal principal
    ) {
        return membershipService.createLedgerBook(principal.userId());
    }

    @DeleteMapping("/ledger-books/current")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteCurrentLedgerBook(
            @AuthenticationPrincipal DondokPrincipal principal,
            @Valid @RequestBody LedgerBookDeletionRequest request
    ) {
        membershipService.deleteCurrentLedgerBook(
                principal.userId(),
                new MembershipService.DeleteLedgerBookCommand(
                        request.expectedLedgerId(),
                        request.expectedVersion(),
                        request.confirmationPhrase()));
    }

    @GetMapping("/ledger-books/current/invitations")
    List<MembershipService.InvitationSummary> invitations(
            @AuthenticationPrincipal DondokPrincipal principal
    ) {
        return membershipService.invitations(principal.userId());
    }

    @PostMapping("/ledger-books/current/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    MembershipService.IssuedInvitation issueInvitation(
            @AuthenticationPrincipal DondokPrincipal principal
    ) {
        return membershipService.issueInvitation(principal.userId());
    }

    @DeleteMapping("/ledger-books/current/invitations/{invitationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeInvitation(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID invitationId
    ) {
        membershipService.revokeInvitation(principal.userId(), invitationId);
    }

    @PostMapping("/ledger-invitations/preview")
    MembershipService.InvitationPreview previewInvitation(
            @AuthenticationPrincipal DondokPrincipal principal,
            @Valid @RequestBody InvitationCodeRequest request
    ) {
        return membershipService.previewInvitation(principal.userId(), request.code());
    }

    @PostMapping("/ledger-invitations/redemptions")
    @ResponseStatus(HttpStatus.CREATED)
    MembershipService.LedgerBookView redeemInvitation(
            @AuthenticationPrincipal DondokPrincipal principal,
            @Valid @RequestBody InvitationCodeRequest request
    ) {
        return membershipService.redeemInvitation(principal.userId(), request.code());
    }

    public record InvitationCodeRequest(
            @NotBlank @Size(min = 32, max = 100) String code
    ) {
    }

    public record LedgerBookDeletionRequest(
            @NotNull UUID expectedLedgerId,
            @NotNull @Min(0) Long expectedVersion,
            String confirmationPhrase
    ) {
    }
}
