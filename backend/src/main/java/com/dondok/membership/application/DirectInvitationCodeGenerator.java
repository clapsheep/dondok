package com.dondok.membership.application;

import java.security.SecureRandom;
import org.springframework.stereotype.Component;

@Component
public class DirectInvitationCodeGenerator {

    private static final int CODE_SPACE = 1_000_000;

    private final SecureRandom secureRandom = new SecureRandom();

    public String issue() {
        int value = secureRandom.nextInt(CODE_SPACE);
        String digits = Integer.toString(value);
        return "0".repeat(6 - digits.length()) + digits;
    }
}
