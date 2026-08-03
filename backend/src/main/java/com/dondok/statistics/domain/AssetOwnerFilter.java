package com.dondok.statistics.domain;

import java.util.UUID;

public record AssetOwnerFilter(Type type, UUID memberId) {
    public enum Type {
        ALL,
        JOINT,
        MEMBER
    }
}
