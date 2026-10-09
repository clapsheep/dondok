package com.dondok.auth.application;

import com.dondok.common.error.ApiException;
import org.springframework.http.HttpStatus;

public record SignUpConsent(String version, boolean age14OrOlder, boolean termsAccepted, boolean privacyAccepted) {
    public static final String CURRENT_VERSION = "2026-10-09.1";

    public static void requireValid(SignUpConsent consent) {
        if (consent == null || !consent.age14OrOlder() || !consent.termsAccepted() || !consent.privacyAccepted()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SIGNUP_CONSENT_REQUIRED",
                    "만 14세 이상 확인과 필수 약관 동의가 필요해요.");
        }
        if (!CURRENT_VERSION.equals(consent.version())) {
            throw new ApiException(HttpStatus.CONFLICT, "SIGNUP_CONSENT_VERSION_CHANGED",
                    "약관이 변경되었어요. 최신 내용을 확인하고 다시 동의해 주세요.");
        }
    }
}
