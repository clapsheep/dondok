package com.dondok.auth.application;

import com.dondok.auth.domain.AuthMailGateway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class AuthMailEventListener {

    private static final Logger LOGGER = LoggerFactory.getLogger(AuthMailEventListener.class);
    private final AuthMailGateway mailGateway;

    public AuthMailEventListener(AuthMailGateway mailGateway) {
        this.mailGateway = mailGateway;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void send(AuthMailEvent event) {
        try {
            if (event.type() == AuthMailEvent.Type.EMAIL_VERIFICATION) {
                mailGateway.sendEmailVerification(event.recipient(), event.displayName(), event.rawToken());
            } else {
                mailGateway.sendPasswordReset(event.recipient(), event.displayName(), event.rawToken());
            }
        } catch (RuntimeException exception) {
            LOGGER.error("Authentication email delivery failed: type={}, recipientDomain={}",
                    event.type(), recipientDomain(event.recipient()), exception);
        }
    }

    private String recipientDomain(String recipient) {
        int separator = recipient.lastIndexOf('@');
        return separator >= 0 ? recipient.substring(separator + 1) : "invalid";
    }
}
