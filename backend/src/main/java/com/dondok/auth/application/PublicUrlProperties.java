package com.dondok.auth.application;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dondok")
public record PublicUrlProperties(String publicUrl) {
}
