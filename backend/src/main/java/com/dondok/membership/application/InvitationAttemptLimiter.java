package com.dondok.membership.application;

import com.dondok.common.error.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class InvitationAttemptLimiter {

    private static final int MAX_ATTEMPTS = 20;
    private static final Duration WINDOW = Duration.ofMinutes(10);

    private final ConcurrentHashMap<UUID, AttemptWindow> attemptsByUser = new ConcurrentHashMap<>();
    private final Clock clock;

    public InvitationAttemptLimiter(Clock clock) {
        this.clock = clock;
    }

    public void check(UUID userId) {
        Instant now = clock.instant();
        AtomicBoolean allowed = new AtomicBoolean(true);
        attemptsByUser.compute(userId, (ignored, current) -> {
            if (current == null || !now.isBefore(current.startedAt().plus(WINDOW))) {
                return new AttemptWindow(now, 1);
            }
            if (current.attempts() >= MAX_ATTEMPTS) {
                allowed.set(false);
                return current;
            }
            return new AttemptWindow(current.startedAt(), current.attempts() + 1);
        });
        if (!allowed.get()) {
            throw new ApiException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "INVITATION_RATE_LIMITED",
                    "초대 코드를 너무 많이 확인했습니다. 잠시 후 다시 시도해 주세요.");
        }
    }

    private record AttemptWindow(Instant startedAt, int attempts) {
    }
}
