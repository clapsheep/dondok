package com.dondok.auth.infrastructure.security;

import com.dondok.auth.application.AuthProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class AbsoluteSessionLifetimeFilter extends OncePerRequestFilter {

    public static final String SESSION_CREATED_AT = "DONDOK_SESSION_CREATED_AT";

    private final AuthProperties properties;
    private final Clock clock;

    public AbsoluteSessionLifetimeFilter(AuthProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        var session = request.getSession(false);
        if (session != null) {
            Object createdAtValue = session.getAttribute(SESSION_CREATED_AT);
            if (createdAtValue instanceof Long createdAt
                    && clock.millis() - createdAt > properties.absoluteSessionTtl().toMillis()) {
                session.invalidate();
            }
        }
        filterChain.doFilter(request, response);
    }
}
