package com.dondok.auth.domain;

public interface AuthMailGateway {
    void sendEmailVerification(String recipient, String displayName, String rawToken);

    void sendPasswordReset(String recipient, String displayName, String rawToken);
}
