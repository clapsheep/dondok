package com.dondok.category.application;

import com.dondok.category.domain.CategoryKind;
import com.dondok.category.domain.DefaultCategory;
import com.dondok.category.infrastructure.persistence.CategoryEntity;
import com.dondok.category.infrastructure.persistence.CategoryJdbcRepository;
import com.dondok.category.infrastructure.persistence.CategoryRepository;
import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryService {
    private final CategoryRepository categories;
    private final CategoryJdbcRepository categoryJdbc;
    private final LedgerMemberRepository members;
    private final LedgerMutationGuard mutationGuard;
    private final Clock clock;

    public CategoryService(
            CategoryRepository categories,
            CategoryJdbcRepository categoryJdbc,
            LedgerMemberRepository members,
            LedgerMutationGuard mutationGuard,
            Clock clock
    ) {
        this.categories = categories;
        this.categoryJdbc = categoryJdbc;
        this.members = members;
        this.mutationGuard = mutationGuard;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CategoryView> categories(UUID userId, CategoryKind kind) {
        LedgerMemberEntity member = members.findByUserId(userId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다."));
        Map<UUID, Long> usage = categoryJdbc.transactionUsage(member.getBookId(), kind);
        return categories.findAllByBookIdAndKindAndArchivedAtIsNullOrderBySortOrderAscIdAsc(
                member.getBookId(), kind).stream()
                .map(category -> CategoryView.from(category, usage.getOrDefault(category.getId(), 0L)))
                .toList();
    }

    @Transactional
    public CategoryView create(UUID userId, CreateCategoryCommand command) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMemberExclusively(userId);
        String name = normalizeName(command.name());
        requireAvailableName(member.getBookId(), command.kind(), name, null);
        Instant now = clock.instant();
        int sortOrder = categories.maxActiveSortOrder(member.getBookId(), command.kind()) + 10;
        CategoryEntity category = categories.save(new CategoryEntity(
                UuidV7.next(), member.getBookId(), command.kind(), null, false,
                name, sortOrder, member.getId(), now));
        categories.flush();
        return CategoryView.from(category, 0);
    }

    @Transactional
    public CategoryView update(UUID userId, UUID categoryId, UpdateCategoryCommand command) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMemberExclusively(userId);
        CategoryEntity category = categories.findActiveForUpdate(categoryId, member.getBookId())
                .orElseThrow(this::categoryNotFound);
        requireVersion(category, command.expectedVersion());
        String name = normalizeName(command.name());
        requireAvailableName(member.getBookId(), category.getKind(), name, categoryId);
        category.rename(name, member.getId(), clock.instant());
        categories.flush();
        long usage = categoryJdbc.transactionUsage(member.getBookId(), category.getKind())
                .getOrDefault(categoryId, 0L);
        return CategoryView.from(category, usage);
    }

    @Transactional
    public ArchiveCategoryResult archive(UUID userId, UUID categoryId, long expectedVersion) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMember(userId);
        CategoryEntity category = categories.findActiveForUpdate(categoryId, member.getBookId())
                .orElseThrow(this::categoryNotFound);
        requireVersion(category, expectedVersion);
        if (category.isFallback()) {
            throw error(HttpStatus.CONFLICT, "CATEGORY_FALLBACK_DELETE_FORBIDDEN",
                    "기타 분류는 거래 이동에 필요해 삭제할 수 없습니다.");
        }
        CategoryEntity fallback = categories.findFallbackForUpdate(member.getBookId(), category.getKind())
                .orElseThrow(() -> new IllegalStateException("fallback category is missing"));
        Instant now = clock.instant();
        CategoryJdbcRepository.RemapResult remapped = categoryJdbc.remapTransactions(
                member.getBookId(), categoryId, fallback.getId(), member.getId(), now);
        category.archive(member.getId(), now);
        categories.flush();
        categoryJdbc.insertArchiveAudit(
                member.getBookId(), member.getId(), category, fallback.getId(), remapped, now);
        return new ArchiveCategoryResult(
                categoryId, fallback.getId(), fallback.getName(), remapped.transactionCount(),
                remapped.firstOccurredOn(), remapped.lastOccurredOn());
    }

    public void bootstrap(UUID bookId, UUID memberId, Instant now) {
        for (DefaultCategory category : DefaultCategory.ALL) {
            if (categories.findByBookIdAndKindAndSystemCodeAndArchivedAtIsNull(
                    bookId, category.kind(), category.systemCode()).isEmpty()) {
                categories.save(new CategoryEntity(
                        UuidV7.next(), bookId, category.kind(), category.systemCode(), category.fallback(),
                        category.name(), category.sortOrder(), memberId, now));
            }
        }
        categories.flush();
    }

    private LedgerMemberEntity currentMember(UUID userId) {
        return members.findByUserId(userId).orElseThrow(this::ledgerNotFound);
    }

    private void requireVersion(CategoryEntity category, long expectedVersion) {
        if (category.getVersion() != expectedVersion) {
            throw error(HttpStatus.PRECONDITION_FAILED, "VERSION_CONFLICT",
                    "편집하는 동안 분류가 변경되었습니다.");
        }
    }

    private void requireAvailableName(
            UUID bookId, CategoryKind kind, String name, UUID excludedCategoryId
    ) {
        boolean duplicate = excludedCategoryId == null
                ? categories.existsByBookIdAndKindAndNameIgnoreCaseAndArchivedAtIsNull(bookId, kind, name)
                : categories.existsByBookIdAndKindAndNameIgnoreCaseAndArchivedAtIsNullAndIdNot(
                        bookId, kind, name, excludedCategoryId);
        if (duplicate) {
            throw error(HttpStatus.CONFLICT, "CATEGORY_NAME_CONFLICT",
                    "같은 거래 방향에 이미 사용 중인 분류 이름입니다.");
        }
    }

    private String normalizeName(String value) {
        String name = value == null ? "" : value.strip();
        if (name.isEmpty() || name.length() > 100) {
            throw error(HttpStatus.BAD_REQUEST, "CATEGORY_NAME_INVALID",
                    "분류 이름은 1자부터 100자까지 입력해 주세요.");
        }
        return name;
    }

    private ApiException ledgerNotFound() {
        return error(HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다.");
    }

    private ApiException categoryNotFound() {
        return error(HttpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND", "분류를 찾을 수 없습니다.");
    }

    private ApiException error(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message);
    }

    public record CategoryView(UUID categoryId, CategoryKind kind, String systemCode,
                               String name, boolean isFallback, long transactionCount, long version) {
        private static CategoryView from(CategoryEntity category, long transactionCount) {
            return new CategoryView(category.getId(), category.getKind(), category.getSystemCode(),
                    category.getName(), category.isFallback(), transactionCount, category.getVersion());
        }
    }
    public record CreateCategoryCommand(CategoryKind kind, String name) {
    }
    public record UpdateCategoryCommand(String name, long expectedVersion) {
    }
    public record ArchiveCategoryResult(
            UUID categoryId,
            UUID fallbackCategoryId,
            String fallbackCategoryName,
            long remappedTransactionCount,
            LocalDate firstOccurredOn,
            LocalDate lastOccurredOn
    ) {
    }
}
