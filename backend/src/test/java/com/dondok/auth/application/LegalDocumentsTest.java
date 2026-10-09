package com.dondok.auth.application;

import static org.assertj.core.api.Assertions.*;
import com.dondok.auth.api.LegalController;
import org.junit.jupiter.api.Test;

class LegalDocumentsTest {
    @Test void currentDocumentsExposeConfiguredContactAndPreserveThePreviousConsentVersion() throws Exception {
        var documents = new LegalController("테스트 운영자", "admin@example.test").documents();
        assertThat(documents.version()).isEqualTo(SignUpConsent.CURRENT_VERSION).isNotEqualTo("2026-10-09");
        assertThat(documents.terms()).contains("테스트 운영자", "admin@example.test", "1년").doesNotContain("{{");
        assertThat(documents.privacy()).contains("테스트 운영자", "admin@example.test", "30일", "휴면").doesNotContain("{{");
        assertThat(new org.springframework.core.io.ClassPathResource("legal/2026-10-09/privacy.txt").exists()).isTrue();
    }
}
