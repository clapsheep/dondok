package com.dondok.settlement.application;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@ConditionalOnProperty(
        name = "dondok.settlement.worker.enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class SettlementSchedulingConfiguration {
}
