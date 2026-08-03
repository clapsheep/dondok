package com.dondok.auth.application;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dondok.mail")
public record MailProperties(boolean enabled, String from) {
}
