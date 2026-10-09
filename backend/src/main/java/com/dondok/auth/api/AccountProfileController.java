package com.dondok.auth.api;

import com.dondok.auth.application.AccountProfileService;
import com.dondok.auth.application.DondokPrincipal;
import com.dondok.common.error.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AccountProfileController {
    private final AccountProfileService service;
    public AccountProfileController(AccountProfileService service) { this.service = service; }

    @GetMapping("/profile")
    AccountProfileService.Profile profile(@AuthenticationPrincipal DondokPrincipal principal) {
        return service.profile(principal.userId());
    }
    @PutMapping("/profile")
    AccountProfileService.Profile save(@AuthenticationPrincipal DondokPrincipal principal, @Valid @RequestBody SaveRequest body) {
        return service.save(principal.userId(), body.displayName(), body.email(), body.password(), body.expectedVersion());
    }
    @PostMapping("/profile/email-verification")
    @ResponseStatus(HttpStatus.ACCEPTED)
    void requestEmail(@AuthenticationPrincipal DondokPrincipal principal, @Valid @RequestBody EmailRequest body) {
        service.requestEmail(principal.userId(), body.email(), body.expectedVersion());
    }
    @PostMapping("/profile/email-verification/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirmEmail(@AuthenticationPrincipal DondokPrincipal principal, @Valid @RequestBody CodeRequest body) {
        if (!service.confirmEmail(principal.userId(), body.email(), body.code())) throw new ApiException(
                HttpStatus.BAD_REQUEST, "EMAIL_CHANGE_CODE_INVALID", "인증번호가 틀렸거나 만료됐어요. 5회 오류 시 새 번호를 받아 주세요.");
    }
    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void password(@AuthenticationPrincipal DondokPrincipal principal, @Valid @RequestBody PasswordRequest body, HttpServletRequest request) {
        service.changePassword(principal.userId(), body.currentPassword(), body.newPassword(), body.newPasswordConfirm());
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
    }
    public record SaveRequest(@NotBlank @Size(max = 100) String displayName,
            @NotBlank @Email @Size(max = 320) String email, @NotBlank @Size(max = 128) String password,
            @NotNull @PositiveOrZero Long expectedVersion) {}
    public record EmailRequest(@NotBlank @Email @Size(max = 320) String email, @NotNull @PositiveOrZero Long expectedVersion) {}
    public record CodeRequest(@NotBlank @Email @Size(max = 320) String email, @NotBlank @Pattern(regexp = "^[0-9]{8}$") String code) {}
    public record PasswordRequest(@NotBlank @Size(max = 128) String currentPassword,
            @NotBlank @Size(min = 10, max = 128) String newPassword,
            @NotBlank @Size(min = 10, max = 128) String newPasswordConfirm) {}
}
