package com.dondok.auth.application;

import com.dondok.auth.infrastructure.persistence.LocalCredentialEntity;
import com.dondok.auth.infrastructure.persistence.LocalCredentialRepository;
import java.util.Locale;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DondokUserDetailsService implements UserDetailsService {

    private final LocalCredentialRepository credentials;

    public DondokUserDetailsService(LocalCredentialRepository credentials) {
        this.credentials = credentials;
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String loginId) throws UsernameNotFoundException {
        LocalCredentialEntity credential = credentials.findByLoginIdNormalized(normalize(loginId))
                .orElseThrow(() -> new UsernameNotFoundException("credential not found"));
        var user = credential.getUser();
        return new DondokPrincipal(
                user.getId(),
                credential.getLoginIdNormalized(),
                user.getDisplayName(),
                user.getEmail(),
                credential.getPasswordHash(),
                user.getStatus());
    }

    private String normalize(String value) {
        return value.strip().toLowerCase(Locale.ROOT);
    }
}
