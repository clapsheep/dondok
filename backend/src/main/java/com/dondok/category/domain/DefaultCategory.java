package com.dondok.category.domain;

import java.util.List;

public record DefaultCategory(CategoryKind kind, String systemCode, String name,
                              boolean fallback, int sortOrder) {
    public static final List<DefaultCategory> ALL = List.of(
            new DefaultCategory(CategoryKind.INCOME, "OTHER", "기타 수입", true, 10),
            new DefaultCategory(CategoryKind.EXPENSE, "FOOD", "식비", false, 10),
            new DefaultCategory(CategoryKind.EXPENSE, "TRANSPORT", "교통비", false, 20),
            new DefaultCategory(CategoryKind.EXPENSE, "GROCERIES", "장보기", false, 30),
            new DefaultCategory(CategoryKind.EXPENSE, "HOUSING", "주거비", false, 40),
            new DefaultCategory(CategoryKind.EXPENSE, "TELECOM", "통신비", false, 50),
            new DefaultCategory(CategoryKind.EXPENSE, "FAMILY_EVENT", "경조사비", false, 60),
            new DefaultCategory(CategoryKind.EXPENSE, "EDUCATION", "교육비", false, 70),
            new DefaultCategory(CategoryKind.EXPENSE, "MEDICAL", "의료비", false, 80),
            new DefaultCategory(CategoryKind.EXPENSE, "SUBSCRIPTION", "구독비", false, 90),
            new DefaultCategory(CategoryKind.EXPENSE, "HOUSEHOLD", "생필품", false, 100),
            new DefaultCategory(CategoryKind.EXPENSE, "LEISURE", "여가생활", false, 110),
            new DefaultCategory(CategoryKind.EXPENSE, "OTHER", "기타 지출", true, 120));
}
