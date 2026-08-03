package com.dondok.category.api;

import com.dondok.auth.application.DondokPrincipal;
import com.dondok.category.application.CategoryService;
import com.dondok.category.domain.CategoryKind;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/categories")
public class CategoryController {
    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping
    List<CategoryService.CategoryView> categories(
            @AuthenticationPrincipal DondokPrincipal principal,
            @RequestParam CategoryKind kind
    ) {
        return categoryService.categories(principal.userId(), kind);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    CategoryService.CategoryView create(
            @AuthenticationPrincipal DondokPrincipal principal,
            @Valid @RequestBody CreateCategoryRequest request
    ) {
        return categoryService.create(principal.userId(), request.toCommand());
    }

    @PutMapping("/{categoryId}")
    CategoryService.CategoryView update(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID categoryId,
            @Valid @RequestBody UpdateCategoryRequest request
    ) {
        return categoryService.update(principal.userId(), categoryId, request.toCommand());
    }

    @DeleteMapping("/{categoryId}")
    CategoryService.ArchiveCategoryResult archive(
            @AuthenticationPrincipal DondokPrincipal principal,
            @PathVariable UUID categoryId,
            @RequestParam @Min(0) long expectedVersion
    ) {
        return categoryService.archive(principal.userId(), categoryId, expectedVersion);
    }

    public record CreateCategoryRequest(
            @NotNull CategoryKind kind,
            @NotBlank @Size(max = 100) String name
    ) {
        CategoryService.CreateCategoryCommand toCommand() {
            return new CategoryService.CreateCategoryCommand(kind, name);
        }
    }

    public record UpdateCategoryRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull @Min(0) Long expectedVersion
    ) {
        CategoryService.UpdateCategoryCommand toCommand() {
            return new CategoryService.UpdateCategoryCommand(name, expectedVersion);
        }
    }
}
