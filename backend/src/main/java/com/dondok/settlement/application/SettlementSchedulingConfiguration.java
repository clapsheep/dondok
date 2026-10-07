package com.dondok.settlement.application;

import org.springframework.context.annotation.Configuration;

/** No scheduler: card payments are recorded only by explicit user commands. */
@Configuration
public class SettlementSchedulingConfiguration {}
