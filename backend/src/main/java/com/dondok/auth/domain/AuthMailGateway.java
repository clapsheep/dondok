package com.dondok.auth.domain;

public interface AuthMailGateway {
    void sendEmailVerification(String recipient, String displayName, String rawToken);

    void sendEmailChange(String recipient, String displayName, String code);

    void sendPasswordReset(String recipient, String displayName, String rawToken);
}
