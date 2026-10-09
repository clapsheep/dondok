package com.dondok.auth.api;

import com.dondok.auth.application.SignUpConsent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.io.ClassPathResource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LegalController {
    private final Documents documents;

    public LegalController(@Value("${dondok.legal.operator-name:운영자 설정 대기}") String operator,
            @Value("${dondok.legal.contact-email:문의처 설정 대기}") String contact) throws IOException {
        documents = new Documents(SignUpConsent.CURRENT_VERSION, read("terms", operator, contact),
                read("privacy", operator, contact), read("collection", operator, contact));
    }

    private String read(String kind, String operator, String contact) throws IOException {
        return new ClassPathResource("legal/" + SignUpConsent.CURRENT_VERSION + "/" + kind + ".txt")
                .getContentAsString(StandardCharsets.UTF_8)
                .replace("{{OPERATOR_NAME}}", operator).replace("{{CONTACT_EMAIL}}", contact);
    }

    @GetMapping("/api/legal")
    public Documents documents() { return documents; }

    public record Documents(String version, String terms, String privacy, String collection) {}
}
