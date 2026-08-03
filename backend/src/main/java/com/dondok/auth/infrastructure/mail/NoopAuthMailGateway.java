package com.dondok.auth.infrastructure.mail;

import com.dondok.auth.domain.AuthMailGateway;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "dondok.mail.enabled", havingValue = "false")
public class NoopAuthMailGateway implements AuthMailGateway {
    @Override
    public void sendEmailVerification(String recipient, String displayName, String rawToken) {
    }

    @Override
    public void sendPasswordReset(String recipient, String displayName, String rawToken) {
    }
}
