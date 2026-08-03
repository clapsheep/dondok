package com.dondok.auth.application;

import com.dondok.auth.domain.UserStatus;
import java.io.Serial;
import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public final class DondokPrincipal implements UserDetails, Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private final UUID userId;
    private final String loginId;
    private final String displayName;
    private final String email;
    private final String passwordHash;
    private final UserStatus status;

    public DondokPrincipal(
            UUID userId,
            String loginId,
            String displayName,
            String email,
            String passwordHash,
            UserStatus status
    ) {
        this.userId = userId;
        this.loginId = loginId;
        this.displayName = displayName;
        this.email = email;
        this.passwordHash = passwordHash;
        this.status = status;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of();
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return loginId;
    }

    @Override
    public boolean isAccountNonLocked() {
        return status != UserStatus.LOCKED;
    }

    @Override
    public boolean isEnabled() {
        return status == UserStatus.ACTIVE;
    }

    public UUID userId() {
        return userId;
    }

    public String loginId() {
        return loginId;
    }

    public String displayName() {
        return displayName;
    }

    public String email() {
        return email;
    }
}
