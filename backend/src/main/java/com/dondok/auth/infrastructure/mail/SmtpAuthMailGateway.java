package com.dondok.auth.infrastructure.mail;

import com.dondok.auth.application.MailProperties;
import com.dondok.auth.application.PublicUrlProperties;
import com.dondok.auth.domain.AuthMailGateway;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
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
        send(recipient, "[돈독] 이메일을 인증해 주세요",
                displayName + "님, 아래 링크에서 이메일 인증을 완료해 주세요.\n\n" + link + "\n\n링크는 24시간 동안 유효합니다.");
    }

    @Override
    public void sendPasswordReset(String recipient, String displayName, String rawToken) {
        String link = publicUrlProperties.publicUrl() + "/reset-password?token=" + encode(rawToken);
        send(recipient, "[돈독] 비밀번호를 재설정해 주세요",
                displayName + "님, 아래 링크에서 비밀번호를 재설정해 주세요.\n\n" + link + "\n\n링크는 30분 동안 한 번만 사용할 수 있습니다.");
    }

    private void send(String recipient, String subject, String body) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(mailProperties.from());
        message.setTo(recipient);
        message.setSubject(subject);
        message.setText(body);
        mailSender.send(message);
    }

    private String encode(String rawToken) {
        return URLEncoder.encode(rawToken, StandardCharsets.UTF_8);
    }
}
