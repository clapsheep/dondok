package com.dondok.common.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import org.springframework.stereotype.Component;

@Component
public class SecretTokenService {

    private final SecureRandom secureRandom = new SecureRandom();

    public IssuedToken issue() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        String rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        return new IssuedToken(rawToken, digest(rawToken));
    }

    public String digest(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormatSupport.toHex(digest.digest(rawToken.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public record IssuedToken(String rawToken, String digest) {
    }

    private static final class HexFormatSupport {
        private static final char[] HEX = "0123456789abcdef".toCharArray();

        private HexFormatSupport() {
        }

        static String toHex(byte[] bytes) {
            char[] result = new char[bytes.length * 2];
            for (int index = 0; index < bytes.length; index++) {
                int value = bytes[index] & 0xff;
                result[index * 2] = HEX[value >>> 4];
                result[index * 2 + 1] = HEX[value & 0x0f];
            }
            return new String(result);
        }
    }
}
