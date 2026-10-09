package com.dondok.auth.application;

import static org.assertj.core.api.Assertions.*;
import com.dondok.common.error.ApiException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(properties = "dondok.mail.enabled=false")
class SignUpConsentIntegrationTest {
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;

    @Test void missingFalseAndOldConsentNeverCreateAnAccountOrAuthenticationToken() {
        String login = "consent_" + UUID.randomUUID().toString().substring(0, 12);
        for (SignUpConsent consent : new SignUpConsent[]{null,
                new SignUpConsent(SignUpConsent.CURRENT_VERSION, false, true, true),
                new SignUpConsent(SignUpConsent.CURRENT_VERSION, true, false, true),
                new SignUpConsent(SignUpConsent.CURRENT_VERSION, true, true, false),
                new SignUpConsent("old", true, true, true)}) {
            assertThatThrownBy(() -> auth.signUp(login, "테스트", login + "@example.test", "Consent-test-2026!", consent))
                    .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getErrorCode()).startsWith("SIGNUP_CONSENT_"));
            assertThat(jdbc.queryForObject("select count(*) from app_user where email = ?", Integer.class, login + "@example.test")).isZero();
        }
    }

    @Test void acceptedVersionAndServerTimestampAreAtomicWithTheNewAccount() {
        String login = "consent_" + UUID.randomUUID().toString().substring(0, 12);
        try {
            auth.signUp(login, "테스트", login + "@example.test", "Consent-test-2026!",
                    new SignUpConsent(SignUpConsent.CURRENT_VERSION, true, true, true));
            var receipt = jdbc.queryForMap("""
                    select c.* from account_consent c join app_user u on u.id = c.user_id where u.email = ?
                    """, login + "@example.test");
            assertThat(receipt).containsEntry("document_version", SignUpConsent.CURRENT_VERSION)
                    .containsEntry("age_14_or_older", true).containsEntry("terms_accepted", true).containsEntry("privacy_accepted", true);
            assertThat(receipt.get("accepted_at")).isNotNull();
        } finally { jdbc.update("delete from app_user where email = ?", login + "@example.test"); }
    }
}
