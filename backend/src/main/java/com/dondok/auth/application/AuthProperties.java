package com.dondok.auth.application;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dondok.auth")
public record AuthProperties(
        long verificationTokenHours,
        long resetTokenMinutes,
        long absoluteSessionDays
) {
    public Duration verificationTokenTtl() {
        return Duration.ofHours(verificationTokenHours);
    }

    public Duration resetTokenTtl() {
        return Duration.ofMinutes(resetTokenMinutes);
    }

    public Duration absoluteSessionTtl() {
        return Duration.ofDays(absoluteSessionDays);
    }
}
