package com.dondok.auth.infrastructure.mail;

import com.dondok.auth.application.MailProperties;
import com.dondok.auth.application.PublicUrlProperties;
import com.dondok.auth.domain.AuthMailGateway;
import jakarta.mail.MessagingException;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "dondok.mail.enabled", havingValue = "true", matchIfMissing = true)
public class SmtpAuthMailGateway implements AuthMailGateway {

    private final JavaMailSender mailSender;
    private final MailProperties mailProperties;
    private final PublicUrlProperties publicUrlProperties;

    public SmtpAuthMailGateway(
            JavaMailSender mailSender,
            MailProperties mailProperties,
            PublicUrlProperties publicUrlProperties
    ) {
        this.mailSender = mailSender;
        this.mailProperties = mailProperties;
        this.publicUrlProperties = publicUrlProperties;
    }

    @Override
    public void sendEmailVerification(String recipient, String displayName, String rawToken) {
        String link = publicUrlProperties.publicUrl() + "/verify-email?token=" + encode(rawToken);
        send(recipient, AuthMailContent.verification(displayName, link));
    }

    @Override
    public void sendPasswordReset(String recipient, String displayName, String rawToken) {
        String link = publicUrlProperties.publicUrl() + "/reset-password?token=" + encode(rawToken);
        send(recipient, AuthMailContent.passwordReset(displayName, link));
    }

    @Override
    public void sendEmailChange(String recipient, String displayName, String code) {
        send(recipient, AuthMailContent.emailChange(displayName, code));
    }

    private void send(String recipient, AuthMailContent content) {
        var message = mailSender.createMimeMessage();
        try {
            var helper = new MimeMessageHelper(message, MimeMessageHelper.MULTIPART_MODE_RELATED, StandardCharsets.UTF_8.name());
            helper.setFrom(mailProperties.from(), "돈독");
            helper.setTo(recipient);
            helper.setSubject(content.subject());
            helper.setText(content.text(), content.html());
            helper.addInline("dondok-wordmark", new ClassPathResource("mail/dondok-wordmark.png"), "image/png");
        } catch (MessagingException | UnsupportedEncodingException exception) {
            throw new MailPreparationException("Could not prepare authentication email", exception);
        }
        mailSender.send(message);
    }

    private String encode(String rawToken) {
        return URLEncoder.encode(rawToken, StandardCharsets.UTF_8);
    }
}
