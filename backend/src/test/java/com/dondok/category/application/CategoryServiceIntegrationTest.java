package com.dondok.category.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dondok.asset.application.AssetService;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.category.domain.CategoryKind;
import com.dondok.common.error.ApiException;
import com.dondok.membership.application.MembershipService;
import com.dondok.transaction.application.TransactionService;
import com.dondok.transaction.domain.TransactionType;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class CategoryServiceIntegrationTest {
    @Autowired private CategoryService categoryService;
    @Autowired private MembershipService membershipService;
    @Autowired private AssetService assetService;
    @Autowired private TransactionService transactionService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private final List<UUID> users = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        for (UUID userId : users) {
            jdbcTemplate.update("delete from ledger_book where created_by_user_id = ?", userId);
        }
        for (UUID userId : users) {
            jdbcTemplate.update("delete from app_user where id = ?", userId);
        }
    }

    @Test
    void createRenameAndArchiveRemapsEveryTransactionWithoutChangingMoney() {
        Fixture fixture = fixture();
        AssetService.AssetView bank = assetService.create(
                fixture.userId(), "category-bank",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "생활비 계좌", LocalDate.of(2026, 7, 1), null,
                        100_000, null));

        CategoryService.CategoryView created = categoryService.create(
                fixture.userId(), new CategoryService.CreateCategoryCommand(CategoryKind.EXPENSE, "  외식  "));
        assertThat(created.name()).isEqualTo("외식");
        assertThat(created.version()).isZero();

        CategoryService.CategoryView renamed = categoryService.update(
                fixture.userId(), created.categoryId(),
                new CategoryService.UpdateCategoryCommand("데이트 식비", created.version()));
        assertThat(renamed.name()).isEqualTo("데이트 식비");
        assertThat(renamed.version()).isEqualTo(1);

        TransactionService.TransactionView expense = transactionService.create(
                fixture.userId(), "category-expense",
                new TransactionService.CreateExpense(
                        LocalDate.of(2026, 7, 10), 10_000, renamed.categoryId(), bank.assetId(),
                        fixture.memberId(), "저녁", 1));
        CategoryService.CategoryView inUse = categoryService.categories(
                        fixture.userId(), CategoryKind.EXPENSE).stream()
                .filter(category -> category.categoryId().equals(renamed.categoryId()))
                .findFirst().orElseThrow();
        assertThat(inUse.transactionCount()).isOne();

        long balanceBefore = assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon();
        long totalExpenseBefore = transactionService.calendar(
                fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon();
        CategoryService.ArchiveCategoryResult archived = categoryService.archive(
                fixture.userId(), renamed.categoryId(), renamed.version());

        assertThat(archived.remappedTransactionCount()).isOne();
        assertThat(archived.firstOccurredOn()).isEqualTo(LocalDate.of(2026, 7, 10));
        assertThat(archived.lastOccurredOn()).isEqualTo(LocalDate.of(2026, 7, 10));
        assertThat(categoryService.categories(fixture.userId(), CategoryKind.EXPENSE))
                .noneMatch(category -> category.categoryId().equals(renamed.categoryId()));
        TransactionService.TransactionView remapped = transactionService.transaction(
                fixture.userId(), expense.transactionId());
        assertThat(remapped.category().categoryId()).isEqualTo(archived.fallbackCategoryId());
        assertThat(remapped.version()).isEqualTo(expense.version() + 1);
        assertThatThrownBy(() -> transactionService.update(
                fixture.userId(), expense.transactionId(),
                new TransactionService.UpdateCommand(
                        TransactionType.EXPENSE,
                        expense.occurredOn(), expense.amountWon(), renamed.categoryId(),
                        bank.assetId(), null, null, fixture.memberId(), "오래된 분류 draft",
                        expense.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
        assertThat(assetService.asset(fixture.userId(), bank.assetId()).currentBalanceWon())
                .isEqualTo(balanceBefore);
        assertThat(transactionService.calendar(fixture.userId(), YearMonth.of(2026, 7)).totalExpenseWon())
                .isEqualTo(totalExpenseBefore);
        assertThat(count("select count(*) from audit_log where entity_type = 'CATEGORY' and entity_id = ?",
                renamed.categoryId())).isOne();
    }

    @Test
    void duplicateFallbackAndStaleCategoryCommandsAreRejected() {
        Fixture fixture = fixture();
        CategoryService.CategoryView category = categoryService.create(
                fixture.userId(), new CategoryService.CreateCategoryCommand(CategoryKind.INCOME, "용돈"));

        assertThatThrownBy(() -> categoryService.create(
                fixture.userId(), new CategoryService.CreateCategoryCommand(CategoryKind.INCOME, "용돈")))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("CATEGORY_NAME_CONFLICT"));

        CategoryService.CategoryView updated = categoryService.update(
                fixture.userId(), category.categoryId(),
                new CategoryService.UpdateCategoryCommand("부수입", category.version()));
        assertThatThrownBy(() -> categoryService.update(
                fixture.userId(), category.categoryId(),
                new CategoryService.UpdateCategoryCommand("오래된 수정", category.version())))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
        assertThat(categoryService.update(
                fixture.userId(), category.categoryId(),
                new CategoryService.UpdateCategoryCommand("기타 부수입", updated.version())).version())
                .isEqualTo(2);

        CategoryService.CategoryView fallback = categoryService.categories(
                        fixture.userId(), CategoryKind.INCOME).stream()
                .filter(CategoryService.CategoryView::isFallback).findFirst().orElseThrow();
        assertThatThrownBy(() -> categoryService.archive(
                fixture.userId(), fallback.categoryId(), fallback.version()))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode())
                                .isEqualTo("CATEGORY_FALLBACK_DELETE_FORBIDDEN"));
    }

    @Test
    void reorderPersistsTheWholeDirectionAtomicallyAndRejectsAStaleOrder() {
        Fixture fixture = fixture();
        List<CategoryService.CategoryView> original = categoryService.categories(
                fixture.userId(), CategoryKind.EXPENSE);
        List<CategoryService.CategoryOrderItem> reversed = IntStream.range(0, original.size())
                .mapToObj(index -> original.get(original.size() - index - 1))
                .map(category -> new CategoryService.CategoryOrderItem(
                        category.categoryId(), category.version()))
                .toList();

        List<CategoryService.CategoryView> reordered = categoryService.reorder(
                fixture.userId(), new CategoryService.ReorderCategoriesCommand(
                        CategoryKind.EXPENSE, reversed));

        assertThat(reordered).extracting(CategoryService.CategoryView::categoryId)
                .containsExactlyElementsOf(reversed.stream()
                        .map(CategoryService.CategoryOrderItem::categoryId).toList());
        assertThat(categoryService.categories(fixture.userId(), CategoryKind.EXPENSE))
                .extracting(CategoryService.CategoryView::categoryId)
                .containsExactlyElementsOf(reordered.stream()
                        .map(CategoryService.CategoryView::categoryId).toList());
        assertThatThrownBy(() -> categoryService.reorder(
                fixture.userId(), new CategoryService.ReorderCategoriesCommand(
                        CategoryKind.EXPENSE, reversed)))
                .isInstanceOfSatisfying(ApiException.class,
                        exception -> assertThat(exception.getErrorCode()).isEqualTo("VERSION_CONFLICT"));
    }

    @Test
    void categoryArchiveAndTransactionCreateNeverLeaveAnActiveReferenceToArchivedCategory()
            throws Exception {
        Fixture fixture = fixture();
        AssetService.AssetView bank = assetService.create(
                fixture.userId(), "category-race-bank",
                new AssetService.AssetCommand(
                        assetType(fixture.userId(), "BANK"), AssetOwnershipScope.PERSONAL,
                        fixture.memberId(), "경쟁 계좌", LocalDate.of(2026, 7, 1), null,
                        0, null));
        CategoryService.CategoryView category = categoryService.create(
                fixture.userId(), new CategoryService.CreateCategoryCommand(CategoryKind.EXPENSE, "경쟁 분류"));
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<String> archive = executor.submit(() -> {
                ready.countDown();
                start.await();
                categoryService.archive(fixture.userId(), category.categoryId(), category.version());
                return "ARCHIVED";
            });
            Future<String> create = executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    transactionService.create(
                            fixture.userId(), "category-race-transaction",
                            new TransactionService.CreateExpense(
                                    LocalDate.of(2026, 7, 10), 1_000, category.categoryId(),
                                    bank.assetId(), fixture.memberId(), "경쟁 거래", 1));
                    return "CREATED";
                } catch (ApiException exception) {
                    return exception.getErrorCode();
                }
            });
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(archive.get(10, TimeUnit.SECONDS)).isEqualTo("ARCHIVED");
            assertThat(create.get(10, TimeUnit.SECONDS))
                    .isIn("CREATED", "TRANSACTION_CATEGORY_INVALID");
        } finally {
            executor.shutdownNow();
        }

        assertThat(count("""
                select count(*)
                  from ledger_transaction transaction
                  join category on category.id = transaction.category_id
                 where transaction.book_id = ? and transaction.category_id = ?
                   and transaction.deleted_at is null and category.archived_at is not null
                """, fixture.bookId(), category.categoryId())).isZero();
    }

    private Fixture fixture() {
        UUID userId = createUser("분류 사용자");
        MembershipService.LedgerBookView book = membershipService.createLedgerBook(userId);
        UUID memberId = book.members().stream().filter(MembershipService.LedgerMemberView::currentUser)
                .findFirst().orElseThrow().memberId();
        return new Fixture(userId, book.ledgerId(), memberId);
    }

    private UUID assetType(UUID userId, String systemCode) {
        return assetService.assetTypes(userId).stream()
                .filter(type -> systemCode.equals(type.systemCode()))
                .findFirst().orElseThrow().assetTypeId();
    }

    private UUID createUser(String displayName) {
        UUID userId = UUID.randomUUID();
        users.add(userId);
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into app_user (
                    id, display_name, email, status, email_verified_at,
                    locale, time_zone, created_at, updated_at, version
                ) values (?, ?, ?, 'ACTIVE', ?, 'ko-KR', 'Asia/Seoul', ?, ?, 0)
                """, userId, displayName, userId + "@category.test", now, now, now);
        return userId;
    }

    private long count(String sql, Object... arguments) {
        return jdbcTemplate.queryForObject(sql, Long.class, arguments);
    }

    private record Fixture(UUID userId, UUID bookId, UUID memberId) {
    }
}
