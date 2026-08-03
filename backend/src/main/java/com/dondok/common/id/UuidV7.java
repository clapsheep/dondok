package com.dondok.common.id;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.UUID;

public final class UuidV7 {

    private static final SecureRandom RANDOM = new SecureRandom();

    private UuidV7() {
    }

    public static UUID next() {
        return next(Clock.systemUTC());
    }

    static UUID next(Clock clock) {
        long timestamp = clock.millis() & 0xFFFFFFFFFFFFL;
        long randomA = RANDOM.nextInt(1 << 12);
        long mostSignificantBits = (timestamp << 16) | 0x7000L | randomA;
        long leastSignificantBits = RANDOM.nextLong();
        leastSignificantBits &= 0x3FFFFFFFFFFFFFFFL;
        leastSignificantBits |= 0x8000000000000000L;
        return new UUID(mostSignificantBits, leastSignificantBits);
    }
}
