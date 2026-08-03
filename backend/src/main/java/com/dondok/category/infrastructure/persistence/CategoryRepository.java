package com.dondok.category.infrastructure.persistence;

import com.dondok.category.domain.CategoryKind;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CategoryRepository extends JpaRepository<CategoryEntity, UUID> {
    List<CategoryEntity> findAllByBookIdAndKindAndArchivedAtIsNullOrderBySortOrderAscIdAsc(
            UUID bookId, CategoryKind kind);
    Optional<CategoryEntity> findByIdAndBookIdAndArchivedAtIsNull(UUID id, UUID bookId);
    Optional<CategoryEntity> findByBookIdAndKindAndSystemCodeAndArchivedAtIsNull(
            UUID bookId, CategoryKind kind, String systemCode);
    boolean existsByBookIdAndKindAndNameIgnoreCaseAndArchivedAtIsNull(
            UUID bookId, CategoryKind kind, String name);
    boolean existsByBookIdAndKindAndNameIgnoreCaseAndArchivedAtIsNullAndIdNot(
            UUID bookId, CategoryKind kind, String name, UUID id);

    @Query("select coalesce(max(category.sortOrder), 0) from CategoryEntity category "
            + "where category.bookId = :bookId and category.kind = :kind and category.archivedAt is null")
    int maxActiveSortOrder(@Param("bookId") UUID bookId, @Param("kind") CategoryKind kind);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select category from CategoryEntity category where category.id = :id "
            + "and category.bookId = :bookId and category.archivedAt is null")
    Optional<CategoryEntity> findActiveForRead(
            @Param("id") UUID id, @Param("bookId") UUID bookId);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select category from CategoryEntity category where category.id = :id "
            + "and category.bookId = :bookId")
    Optional<CategoryEntity> findForRead(
            @Param("id") UUID id, @Param("bookId") UUID bookId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select category from CategoryEntity category where category.id = :id "
            + "and category.bookId = :bookId and category.archivedAt is null")
    Optional<CategoryEntity> findActiveForUpdate(
            @Param("id") UUID id, @Param("bookId") UUID bookId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select category from CategoryEntity category where category.bookId = :bookId "
            + "and category.kind = :kind and category.fallback = true and category.archivedAt is null")
    Optional<CategoryEntity> findFallbackForUpdate(
            @Param("bookId") UUID bookId, @Param("kind") CategoryKind kind);
}
