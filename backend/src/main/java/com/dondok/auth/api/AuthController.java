package com.dondok.auth.api;

import com.dondok.auth.application.AuthService;
import com.dondok.auth.application.DondokPrincipal;
import com.dondok.auth.infrastructure.security.AbsoluteSessionLifetimeFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;

    public AuthController(
            AuthService authService,
            AuthenticationManager authenticationManager,
            SecurityContextRepository securityContextRepository
    ) {
        this.authService = authService;
        this.authenticationManager = authenticationManager;
        this.securityContextRepository = securityContextRepository;
    }

    @GetMapping("/csrf")
    CsrfResponse csrf(CsrfToken csrfToken) {
        return new CsrfResponse(csrfToken.getHeaderName(), csrfToken.getParameterName(), csrfToken.getToken());
    }

    @GetMapping("/login-ids/{loginId}/availability")
    LoginIdAvailabilityResponse loginIdAvailability(
            @PathVariable
            @Pattern(regexp = "^[A-Za-z0-9._-]{4,30}$") String loginId
    ) {
        return new LoginIdAvailabilityResponse(authService.isLoginIdAvailable(loginId));
    }

    @PostMapping("/sign-up")
    @ResponseStatus(HttpStatus.ACCEPTED)
    SignUpResponse signUp(@Valid @RequestBody SignUpRequest request) {
        AuthService.SignUpResult result = authService.signUp(
                request.loginId(), request.displayName(), request.email(), request.password());
        return new SignUpResponse(result.email());
    }

    @PostMapping("/email-verifications")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void verifyEmail(@Valid @RequestBody TokenRequest request) {
        authService.verifyEmail(request.token());
    }

    @PostMapping("/session")
    SessionUser login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse
    ) {
        Authentication authentication = authenticationManager.authenticate(
                UsernamePasswordAuthenticationToken.unauthenticated(request.loginId(), request.password()));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);

        HttpSession session = servletRequest.getSession(true);
        servletRequest.changeSessionId();
        session.setAttribute(AbsoluteSessionLifetimeFilter.SESSION_CREATED_AT, System.currentTimeMillis());
        securityContextRepository.saveContext(context, servletRequest, servletResponse);
        return SessionUser.from((DondokPrincipal) authentication.getPrincipal());
    }

    @GetMapping("/me")
    SessionUser me(@AuthenticationPrincipal DondokPrincipal principal) {
        return SessionUser.from(principal);
    }

    @DeleteMapping("/session")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();
    }

    @DeleteMapping("/sessions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logoutAll(@AuthenticationPrincipal DondokPrincipal principal, HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        authService.deleteAllSessions(principal.loginId());
        SecurityContextHolder.clearContext();
    }

    @PostMapping("/password-resets")
    @ResponseStatus(HttpStatus.ACCEPTED)
    void requestPasswordReset(@Valid @RequestBody PasswordResetRequest request) {
        authService.requestPasswordReset(request.email());
    }

    @PostMapping("/password-resets/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirmPasswordReset(@Valid @RequestBody PasswordResetConfirmRequest request) {
        authService.resetPassword(request.token(), request.newPassword());
    }

    public record SignUpRequest(
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9._-]{4,30}$") String loginId,
            @NotBlank @Size(max = 100) String displayName,
            @NotBlank @Email @Size(max = 320) String email,
            @NotBlank @Size(min = 10, max = 128) String password
    ) {
    }

    public record SignUpResponse(String email) {
    }

    public record LoginIdAvailabilityResponse(boolean available) {
    }

    public record LoginRequest(@NotBlank String loginId, @NotBlank String password) {
    }

    public record TokenRequest(@NotBlank @Size(max = 200) String token) {
    }

    public record PasswordResetRequest(@NotBlank @Email @Size(max = 320) String email) {
    }

    public record PasswordResetConfirmRequest(
            @NotBlank @Size(max = 200) String token,
            @NotBlank @Size(min = 10, max = 128) String newPassword
    ) {
    }

    public record CsrfResponse(String headerName, String parameterName, String token) {
    }

    public record SessionUser(String userId, String loginId, String displayName, String email) {
        static SessionUser from(DondokPrincipal principal) {
            return new SessionUser(
                    principal.userId().toString(),
                    principal.loginId(),
                    principal.displayName(),
                    principal.email());
        }
    }
}
