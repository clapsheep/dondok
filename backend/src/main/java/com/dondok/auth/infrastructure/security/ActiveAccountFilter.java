package com.dondok.auth.infrastructure.security;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.common.error.SecurityProblemWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import com.dondok.auth.application.AccountLifecycleService;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/** Rejects a stale session, including a login racing with account withdrawal. */
public class ActiveAccountFilter extends OncePerRequestFilter {
    private final AccountLifecycleService lifecycle;
    private final SecurityProblemWriter problems;

    public ActiveAccountFilter(AccountLifecycleService lifecycle, SecurityProblemWriter problems) {
        this.lifecycle = lifecycle;
        this.problems = problems;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof DondokPrincipal principal
                && !lifecycle.recordAuthenticatedActivity(principal.userId(), principal.getPassword())) {
            var session = request.getSession(false);
            if (session != null) session.invalidate();
            SecurityContextHolder.clearContext();
            problems.unauthorized(request, response, null);
            return;
        }
        chain.doFilter(request, response);
    }
}
