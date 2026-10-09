package com.dondok.auth.infrastructure.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dondok.auth.application.MailProperties;
import com.dondok.auth.application.PublicUrlProperties;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.JavaMailSender;

class SmtpAuthMailGatewayTest {
    @Test
    void verificationDeliversBrandedMultipartMailWithEscapedNameAndOriginalToken() throws Exception {
        var sender = mock(JavaMailSender.class);
        var message = new MimeMessage(Session.getInstance(new Properties()));
        when(sender.createMimeMessage()).thenReturn(message);
        var gateway = new SmtpAuthMailGateway(sender, new MailProperties(true, "no-reply@example.test"),
                new PublicUrlProperties("https://ledger.example.test"));

        gateway.sendEmailVerification("member@example.test", "<img src=x> & {{link}}", "test+/=&token");
        verify(sender).send(message);
        message.saveChanges();
        assertThat(((InternetAddress) message.getFrom()[0]).getPersonal()).isEqualTo("돈독");
        assertThat(((InternetAddress) message.getFrom()[0]).getAddress()).isEqualTo("no-reply@example.test");
        assertThat(((InternetAddress) message.getAllRecipients()[0]).getAddress()).isEqualTo("member@example.test");
        assertThat(message.getSubject()).isEqualTo("[돈독] 이메일을 인증해 주세요");
        assertThat(message.isMimeType("multipart/related")).isTrue();

        var parts = leafParts(message);
        String plain = content(parts, "text/plain");
        String html = content(parts, "text/html");
        String link = "https://ledger.example.test/verify-email?token=test%2B%2F%3D%26token";
        assertThat(plain).contains(link, "24시간", "한 번만");
        assertThat(html).contains("href=\"" + link + "\"", "&lt;img src=x&gt; &amp; {{link}}", "이메일 인증하기", "24시간")
                .doesNotContain("<img src=x>", "<script", "src=\"https://");
        Part logo = parts.stream().filter(p -> {
            try { return p.isMimeType("image/png"); } catch (Exception e) { throw new IllegalStateException(e); }
        }).findFirst().orElseThrow();
        assertThat(logo.getDisposition()).isEqualTo(Part.INLINE);
        assertThat(logo.getHeader("Content-ID")).containsExactly("<dondok-wordmark>");
        assertThat(logo.getInputStream().readAllBytes()).isEqualTo(new ClassPathResource("mail/dondok-wordmark.png").getContentAsByteArray());
    }

    @Test
    void passwordResetKeepsItsOwnActionAndThirtyMinuteExpiry() throws Exception {
        var sender = mock(JavaMailSender.class);
        var message = new MimeMessage(Session.getInstance(new Properties()));
        when(sender.createMimeMessage()).thenReturn(message);
        var gateway = new SmtpAuthMailGateway(sender, new MailProperties(true, "no-reply@example.test"),
                new PublicUrlProperties("https://ledger.example.test"));
        gateway.sendPasswordReset("member@example.test", "테스트", "reset-preview");
        verify(sender).send(message);
        message.saveChanges();
        assertThat(message.getSubject()).isEqualTo("[돈독] 비밀번호를 재설정해 주세요");
        for (String mimeType : List.of("text/plain", "text/html")) {
            assertThat(content(leafParts(message), mimeType)).contains("/reset-password?token=reset-preview", "30분", "기존 비밀번호는 변경되지 않아요")
                    .doesNotContain("24시간", "/verify-email");
        }
    }

    @Test
    void emailChangeSendsEscapedCodeMailWithNoPrematureSaveLink() throws Exception {
        var sender = mock(JavaMailSender.class);
        var message = new MimeMessage(Session.getInstance(new Properties()));
        when(sender.createMimeMessage()).thenReturn(message);
        var gateway = new SmtpAuthMailGateway(sender, new MailProperties(true, "no-reply@example.test"),
                new PublicUrlProperties("https://ledger.example.test"));
        gateway.sendEmailChange("changed@example.test", "<script>이름</script>", "01234567");
        verify(sender).send(message);
        message.saveChanges();
        assertThat(message.getSubject()).isEqualTo("[돈독] 이메일 변경 인증번호");
        for (String mime : List.of("text/plain", "text/html")) {
            assertThat(content(leafParts(message), mime)).contains("01234567", "10분", "현재 비밀번호")
                    .doesNotContain("/verify-email", "/reset-password");
        }
        assertThat(content(leafParts(message), "text/html")).contains("&lt;script&gt;").doesNotContain("<script>");
    }

    @Test
    void renderPreviewsUsingTheProductionTemplate() throws Exception {
        String logo = "data:image/png;base64," + Base64.getEncoder().encodeToString(new ClassPathResource("mail/dondok-wordmark.png").getContentAsByteArray());
        Path directory = Path.of("build", "mail-preview");
        Files.createDirectories(directory);
        var verification = AuthMailContent.verification("다정", "https://ledger.example.test/verify-email?token=preview-only");
        var reset = AuthMailContent.passwordReset("다정", "https://ledger.example.test/reset-password?token=preview-only");
        Files.writeString(directory.resolve("verification.html"), verification.html().replace("cid:dondok-wordmark", logo));
        Files.writeString(directory.resolve("password-reset.html"), reset.html().replace("cid:dondok-wordmark", logo));
        assertThat(verification.html()).doesNotContain("{{");
        assertThat(reset.html()).doesNotContain("{{");
    }

    private static List<Part> leafParts(Part part) throws Exception {
        if (!(part.getContent() instanceof Multipart multipart)) return List.of(part);
        List<Part> parts = new ArrayList<>();
        for (int i = 0; i < multipart.getCount(); i++) parts.addAll(leafParts(multipart.getBodyPart(i)));
        return parts;
    }

    private static String content(List<Part> parts, String mimeType) throws Exception {
        for (Part part : parts) if (part.isMimeType(mimeType)) return (String) part.getContent();
        throw new AssertionError("Missing MIME part: " + mimeType);
    }
}
