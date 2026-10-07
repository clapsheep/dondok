package com.dondok.statistics.domain;

public record AssetFormation(long savingsDepositWon, long savingsWithdrawalWon,
                             long investmentDepositWon, long investmentWithdrawalWon) {
    public static final AssetFormation ZERO = new AssetFormation(0, 0, 0, 0);
}
