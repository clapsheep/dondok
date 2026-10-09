package com.dondok.auth.application;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "dondok.auth.maintenance-enabled", havingValue = "true", matchIfMissing = true)
public class AccountMaintenanceSchedule {
    private final AccountLifecycleService lifecycle;

    public AccountMaintenanceSchedule(AccountLifecycleService lifecycle) { this.lifecycle = lifecycle; }

    @Scheduled(cron = "0 20 * * * *", zone = "Asia/Seoul")
    public void maintain() {
        lifecycle.maintain();
        // A heartbeat also advances time-based log rotation on otherwise idle installations.
        org.slf4j.LoggerFactory.getLogger(AccountMaintenanceSchedule.class).info("Account maintenance completed");
    }
}
