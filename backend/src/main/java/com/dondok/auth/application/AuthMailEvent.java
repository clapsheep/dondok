package com.dondok.auth.application;

public record AuthMailEvent(Type type, String recipient, String displayName, String rawToken) {
    public enum Type {
        EMAIL_VERIFICATION,
        EMAIL_CHANGE,
        PASSWORD_RESET
    }
}
