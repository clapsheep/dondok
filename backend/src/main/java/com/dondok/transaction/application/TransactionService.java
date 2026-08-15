package com.dondok.transaction.application;

import com.dondok.asset.domain.AssetBehavior;
import com.dondok.asset.domain.CardBillingCyclePolicy;
import com.dondok.asset.infrastructure.persistence.AssetEntity;
import com.dondok.asset.infrastructure.persistence.AssetLedgerRepository;
import com.dondok.asset.infrastructure.persistence.AssetRepository;
import com.dondok.asset.infrastructure.persistence.AssetTypeEntity;
import com.dondok.asset.infrastructure.persistence.AssetTypeRepository;
import com.dondok.asset.infrastructure.persistence.CardSettingEntity;
import com.dondok.asset.infrastructure.persistence.CardSettingRepository;
import com.dondok.asset.infrastructure.persistence.DebitCardSettingEntity;
import com.dondok.asset.infrastructure.persistence.DebitCardSettingRepository;
import com.dondok.category.domain.CategoryKind;
import com.dondok.category.infrastructure.persistence.CategoryEntity;
import com.dondok.category.infrastructure.persistence.CategoryRepository;
import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import com.dondok.transaction.domain.TransactionType;
import com.dondok.transaction.domain.TransferSubtype;
import com.dondok.transaction.infrastructure.persistence.TransactionIdempotencyRepository;
import com.dondok.transaction.infrastructure.persistence.TransactionJdbcRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TransactionService {
    private static final String CREATE_SCOPE = "POST:/api/transactions";
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_RANGE_DAYS = 366;
    private static final int MAX_INSTALLMENTS = 60;
    private static final Set<String> TRANSFER_ASSET_SYSTEM_CODES = Set.of("BANK", "SAVINGS");

    private final TransactionJdbcRepository transactions;
    private final TransactionIdempotencyRepository idempotency;
    private final LedgerMemberRepository members;
    private final LedgerMutationGuard mutationGuard;
    private final AssetRepository assets;
    private final AssetTypeRepository assetTypes;
    private final CardSettingRepository cardSettings;
    private final DebitCardSettingRepository debitCardSettings;
    private final CategoryRepository categories;
    private final AssetLedgerRepository assetLedger;
    private final CardBillingCyclePolicy billingCyclePolicy;
    private final Clock clock;

    public TransactionService(
            TransactionJdbcRepository transactions,
            TransactionIdempotencyRepository idempotency,
            LedgerMemberRepository members,
            LedgerMutationGuard mutationGuard,
            AssetRepository assets,
            AssetTypeRepository assetTypes,
            CardSettingRepository cardSettings,
            DebitCardSettingRepository debitCardSettings,
            CategoryRepository categories,
            AssetLedgerRepository assetLedger,
            CardBillingCyclePolicy billingCyclePolicy,
            Clock clock
    ) {
        this.transactions = transactions;
        this.idempotency = idempotency;
        this.members = members;
        this.mutationGuard = mutationGuard;
        this.assets = assets;
        this.assetTypes = assetTypes;
        this.cardSettings = cardSettings;
        this.debitCardSettings = debitCardSettings;
        this.categories = categories;
        this.assetLedger = assetLedger;
        this.billingCyclePolicy = billingCyclePolicy;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CalendarView calendar(UUID userId, YearMonth month) {
        return calendar(userId, month, null);
    }

    @Transactional(readOnly = true)
    public CalendarView calendar(UUID userId, YearMonth month, UUID performedByMemberId) {
        LedgerMemberEntity member = currentMember(userId);
        requireOptionalPerformer(member.getBookId(), performedByMemberId);
        LocalDate from = month.atDay(1);
        LocalDate toExclusive = month.plusMonths(1).atDay(1);
        List<DaySummary> days = transactions.calendar(
                        member.getBookId(), from, toExclusive, performedByMemberId).stream()
                .map(row -> new DaySummary(row.date(), row.incomeWon(), row.expenseWon(),
                        row.incomeWon() - row.expenseWon()))
                .toList();
        long income = days.stream().mapToLong(DaySummary::incomeWon).sum();
        long expense = days.stream().mapToLong(DaySummary::expenseWon).sum();
        return new CalendarView(month, income, expense, income - expense, days);
    }

    @Transactional(readOnly = true)
    public TransactionPage transactions(
            UUID userId, LocalDate from, LocalDate toExclusive, String encodedCursor, int limit
    ) {
        return transactions(userId, from, toExclusive, encodedCursor, limit, null);
    }

    @Transactional(readOnly = true)
    public TransactionPage transactions(
            UUID userId, LocalDate from, LocalDate toExclusive, String encodedCursor, int limit,
            UUID performedByMemberId
    ) {
        requireRange(from, toExclusive);
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_PAGE_INVALID", "페이지 크기를 확인해 주세요.");
        }
        TransactionJdbcRepository.Cursor cursor;
        try {
            cursor = TransactionJdbcRepository.decodeCursor(encodedCursor);
        } catch (IllegalArgumentException exception) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_CURSOR_INVALID", "목록 커서가 올바르지 않습니다.");
        }
        LedgerMemberEntity member = currentMember(userId);
        requireOptionalPerformer(member.getBookId(), performedByMemberId);
        TransactionJdbcRepository.PageRows page = transactions.page(
                member.getBookId(), from, toExclusive, cursor, limit, performedByMemberId);
        return new TransactionPage(page.items().stream().map(this::toView).toList(), page.nextCursor());
    }

    @Transactional(readOnly = true)
    public TransactionPage transactionsForAsset(
            UUID userId, UUID assetId, String encodedCursor, int limit
    ) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_PAGE_INVALID", "페이지 크기를 확인해 주세요.");
        }
        TransactionJdbcRepository.Cursor cursor;
        try {
            cursor = TransactionJdbcRepository.decodeCursor(encodedCursor);
        } catch (IllegalArgumentException exception) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_CURSOR_INVALID", "목록 커서가 올바르지 않습니다.");
        }
        LedgerMemberEntity member = currentMember(userId);
        assets.findByIdAndBookId(assetId, member.getBookId())
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "ASSET_NOT_FOUND", "자산을 찾을 수 없습니다."));
        TransactionJdbcRepository.PageRows page = transactions.pageForAsset(
                member.getBookId(), assetId, cursor, limit);
        return new TransactionPage(page.items().stream().map(this::toView).toList(), page.nextCursor());
    }

    @Transactional(readOnly = true)
    public TransactionView transaction(UUID userId, UUID transactionId) {
        LedgerMemberEntity member = currentMember(userId);
        return requiredView(member.getBookId(), transactionId);
    }

    @Transactional
    public TransactionView create(UUID userId, String idempotencyKey, CreateCommand command) {
        LedgerMemberEntity author = mutationGuard.lockCurrentMember(userId);
        Instant now = clock.instant();
        String requestHash = hash(command.toString());
        TransactionIdempotencyRepository.Claim claim = idempotency.claim(
                userId, author.getBookId(), CREATE_SCOPE, idempotencyKey, requestHash, now);
        if (!claim.fresh()) {
            if (!requestHash.equals(claim.requestHash())) {
                throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                        "같은 중복 방지 키를 다른 요청에 사용할 수 없습니다.");
            }
            if ("COMPLETED".equals(claim.status()) && claim.resourceId() != null) {
                return requiredView(author.getBookId(), claim.resourceId());
            }
            throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                    "동일한 거래 등록 요청이 처리 중입니다.");
        }

        UUID performerId = requirePerformer(author.getBookId(), command.performedByMemberId());
        UUID transactionId = UuidV7.next();
        TransactionJdbcRepository.TransactionWrite write;
        CardPurchase cardPurchase = null;
        if (command instanceof CreateIncome income) {
            CategoryEntity category = requireCategory(author.getBookId(), income.categoryId(), CategoryKind.INCOME);
            AssetEntity asset = requireAsset(author.getBookId(), income.assetId());
            write = write(transactionId, author, income, TransactionType.INCOME, null,
                    category.getId(), performerId, asset.getId(),
                    List.of(new TransactionJdbcRepository.PostingWrite(asset.getId(), income.amountWon())), now);
        } else if (command instanceof CreateExpense expense) {
            CategoryEntity category = requireCategory(author.getBookId(), expense.categoryId(), CategoryKind.EXPENSE);
            AssetEntity asset = requireAsset(author.getBookId(), expense.assetId());
            AssetTypeEntity type = requireAssetType(author.getBookId(), asset.getAssetTypeId());
            if (type.getBehavior() == AssetBehavior.CREDIT_CARD) {
                if (expense.installmentCount() < 1 || expense.installmentCount() > MAX_INSTALLMENTS) {
                    throw installmentInvalid();
                }
                CardSettingEntity setting = cardSettings.findById(asset.getId())
                        .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "CARD_SETTINGS_MISSING",
                                "카드 설정을 먼저 입력해 주세요."));
                cardPurchase = new CardPurchase(asset, setting,
                        installments(expense.occurredOn(), expense.amountWon(),
                                expense.installmentCount(), setting));
            } else if (type.getBehavior() == AssetBehavior.DEBIT_CARD) {
                if (expense.installmentCount() != 1) {
                    throw installmentInvalid();
                }
                DebitCardSettingEntity setting = debitCardSettings.findById(asset.getId())
                        .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "DEBIT_CARD_SETTINGS_MISSING",
                                "체크카드의 결제 계좌를 먼저 입력해 주세요."));
                AssetEntity paymentAsset = requireAsset(author.getBookId(), setting.getPaymentAssetId());
                write = write(transactionId, author, expense, TransactionType.EXPENSE, null,
                        category.getId(), performerId, asset.getId(),
                        List.of(new TransactionJdbcRepository.PostingWrite(
                                paymentAsset.getId(), -expense.amountWon())), now);
                transactions.insertTransaction(write);
                idempotency.complete(userId, CREATE_SCOPE, idempotencyKey, transactionId, 201, now);
                return requiredView(author.getBookId(), transactionId);
            } else if (expense.installmentCount() != 1) {
                throw installmentInvalid();
            }
            write = write(transactionId, author, expense, TransactionType.EXPENSE, null,
                    category.getId(), performerId, asset.getId(),
                    List.of(new TransactionJdbcRepository.PostingWrite(asset.getId(), -expense.amountWon())), now);
        } else if (command instanceof CreateTransfer transfer) {
            if (transfer.sourceAssetId().equals(transfer.destinationAssetId())) {
                throw error(HttpStatus.BAD_REQUEST, "TRANSFER_SAME_ASSET", "이체 출발과 도착 자산은 달라야 합니다.");
            }
            AssetEntity source = requireTransferAsset(author.getBookId(), transfer.sourceAssetId());
            AssetEntity destination = requireTransferAsset(
                    author.getBookId(), transfer.destinationAssetId());
            write = write(transactionId, author, transfer, TransactionType.TRANSFER, TransferSubtype.NORMAL,
                    null, performerId, null, List.of(
                            new TransactionJdbcRepository.PostingWrite(source.getId(), -transfer.amountWon()),
                            new TransactionJdbcRepository.PostingWrite(destination.getId(), transfer.amountWon())), now);
        } else {
            throw new IllegalStateException("unsupported transaction command");
        }
        transactions.insertTransaction(write);
        if (cardPurchase != null) {
            transactions.insertCardInstallments(author.getBookId(), transactionId,
                    cardPurchase.asset().getId(), cardPurchase.installments(), cardPurchase.setting(),
                    command.occurredOn().isBefore(cardPurchase.asset().getOpenedOn()), now);
        }
        idempotency.complete(userId, CREATE_SCOPE, idempotencyKey, transactionId, 201, now);
        return requiredView(author.getBookId(), transactionId);
    }

    @Transactional
    public TransactionView update(UUID userId, UUID transactionId, UpdateCommand command) {
        LedgerMemberEntity editor = mutationGuard.lockCurrentMember(userId);
        CategoryEntity lockedCategory = null;
        if (command.type() == TransactionType.INCOME) {
            requireShape(command.categoryId() != null);
            lockedCategory = lockCategory(editor.getBookId(), command.categoryId());
        } else if (command.type() == TransactionType.EXPENSE) {
            requireShape(command.categoryId() != null);
            lockedCategory = lockCategory(editor.getBookId(), command.categoryId());
        }
        TransactionJdbcRepository.TransactionState state = transactions.findStateForUpdate(
                editor.getBookId(), transactionId);
        if (state == null) {
            throw transactionNotFound();
        }
        requireVersion(state, command.expectedVersion());
        requireGeneralMutation(state);
        if (state.type() != command.type()) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_TYPE_IMMUTABLE",
                    "거래 종류는 변경할 수 없습니다. 잘못 선택했다면 기록을 삭제하고 다시 입력해 주세요.");
        }
        if (lockedCategory != null) {
            requireActiveCategoryKind(
                    lockedCategory,
                    command.type() == TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE);
        }
        UUID performerId = requirePerformer(editor.getBookId(), command.performedByMemberId());
        TransactionMutation mutation = mutation(
                editor.getBookId(), state, command, lockedCategory);
        Instant now = clock.instant();
        transactions.updateTransaction(new TransactionJdbcRepository.TransactionUpdateWrite(
                transactionId, editor.getBookId(), command.occurredOn(), command.amountWon(),
                mutation.categoryId(), performerId, mutation.primaryAssetId(),
                stripToNull(command.description()), command.excludedFromStatistics(),
                editor.getId(), command.expectedVersion(), now,
                mutation.postings()));
        if (mutation.cardPurchase() != null) {
            CardPurchase cardPurchase = mutation.cardPurchase();
            transactions.insertCardInstallments(editor.getBookId(), transactionId,
                    cardPurchase.asset().getId(), cardPurchase.installments(), cardPurchase.setting(),
                    command.occurredOn().isBefore(cardPurchase.asset().getOpenedOn()), now);
        }
        return requiredView(editor.getBookId(), transactionId);
    }

    @Transactional
    public DeletedTransactionView delete(UUID userId, UUID transactionId, long expectedVersion) {
        LedgerMemberEntity editor = mutationGuard.lockCurrentMember(userId);
        TransactionJdbcRepository.TransactionState state = transactions.findStateForUpdate(
                editor.getBookId(), transactionId);
        if (state == null) {
            throw transactionNotFound();
        }
        requireVersion(state, expectedVersion);
        requireGeneralMutation(state);
        transactions.softDelete(
                editor.getBookId(), transactionId, expectedVersion, editor.getId(), clock.instant());
        return new DeletedTransactionView(transactionId, expectedVersion + 1);
    }

    private TransactionMutation mutation(
            UUID bookId,
            TransactionJdbcRepository.TransactionState state,
            UpdateCommand command,
            CategoryEntity lockedCategory
    ) {
        TransactionType type = state.type();
        if (type == TransactionType.INCOME) {
            requireShape(command.categoryId() != null && command.assetId() != null
                    && command.sourceAssetId() == null && command.destinationAssetId() == null);
            CategoryEntity category = lockedCategory;
            AssetEntity asset = requireAsset(bookId, command.assetId());
            return new TransactionMutation(category.getId(), asset.getId(),
                    List.of(new TransactionJdbcRepository.PostingWrite(asset.getId(), command.amountWon())), null);
        }
        if (type == TransactionType.EXPENSE) {
            requireShape(command.categoryId() != null && command.assetId() != null
                    && command.sourceAssetId() == null && command.destinationAssetId() == null);
            CategoryEntity category = lockedCategory;
            AssetEntity asset = requireAsset(bookId, command.assetId());
            AssetTypeEntity assetType = requireAssetType(bookId, asset.getAssetTypeId());
            if (assetType.getBehavior() == AssetBehavior.CREDIT_CARD) {
                if (command.installmentCount() < 1 || command.installmentCount() > MAX_INSTALLMENTS) {
                    throw installmentInvalid();
                }
                CardSettingEntity setting = cardSettings.findById(asset.getId())
                        .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "CARD_SETTINGS_MISSING",
                                "카드 설정을 먼저 입력해 주세요."));
                CardPurchase cardPurchase = new CardPurchase(asset, setting,
                        installments(command.occurredOn(), command.amountWon(),
                                command.installmentCount(), setting));
                return new TransactionMutation(category.getId(), asset.getId(),
                        List.of(new TransactionJdbcRepository.PostingWrite(
                                asset.getId(), -command.amountWon())), cardPurchase);
            }
            if (command.installmentCount() != 1) {
                throw installmentInvalid();
            }
            UUID postingAssetId;
            if (asset.getId().equals(state.primaryAssetId())) {
                postingAssetId = state.postingAssetId();
            } else {
                postingAssetId = asset.getId();
                if (assetType.getBehavior() == AssetBehavior.DEBIT_CARD) {
                    DebitCardSettingEntity setting = debitCardSettings.findById(asset.getId())
                            .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "DEBIT_CARD_SETTINGS_MISSING",
                                    "체크카드의 결제 계좌를 먼저 입력해 주세요."));
                    postingAssetId = requireAsset(bookId, setting.getPaymentAssetId()).getId();
                }
            }
            return new TransactionMutation(category.getId(), asset.getId(),
                    List.of(new TransactionJdbcRepository.PostingWrite(
                            postingAssetId, -command.amountWon())), null);
        }
        if (type == TransactionType.TRANSFER) {
            requireShape(command.categoryId() == null && command.assetId() == null
                    && command.sourceAssetId() != null && command.destinationAssetId() != null
                    && !command.excludedFromStatistics());
            if (command.sourceAssetId().equals(command.destinationAssetId())) {
                throw error(HttpStatus.BAD_REQUEST, "TRANSFER_SAME_ASSET",
                        "이체 출발과 도착 자산은 달라야 합니다.");
            }
            AssetEntity source = requireTransferAsset(bookId, command.sourceAssetId());
            AssetEntity destination = requireTransferAsset(bookId, command.destinationAssetId());
            return new TransactionMutation(null, null, List.of(
                    new TransactionJdbcRepository.PostingWrite(source.getId(), -command.amountWon()),
                    new TransactionJdbcRepository.PostingWrite(destination.getId(), command.amountWon())), null);
        }
        throw error(HttpStatus.CONFLICT, "TRANSACTION_MUTATION_NOT_ALLOWED",
                "이 거래는 일반 수정으로 변경할 수 없습니다.");
    }

    private void requireShape(boolean valid) {
        if (!valid) {
            throw error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                    "거래 유형에 맞는 입력값을 확인해 주세요.");
        }
    }

    private void requireVersion(TransactionJdbcRepository.TransactionState state, long expectedVersion) {
        if (state.version() != expectedVersion) {
            throw error(HttpStatus.PRECONDITION_FAILED, "VERSION_CONFLICT",
                    "편집하는 동안 거래가 변경되었습니다.");
        }
    }

    private void requireGeneralMutation(TransactionJdbcRepository.TransactionState state) {
        if (!"MANUAL".equals(state.sourceType())
                || (state.type() == TransactionType.TRANSFER
                && state.transferSubtype() != TransferSubtype.NORMAL)) {
            throw error(HttpStatus.CONFLICT, "SYSTEM_TRANSACTION_MUTATION_NOT_ALLOWED",
                    "자동 정산과 시스템 거래는 일반 수정·삭제로 변경할 수 없습니다.");
        }
        if (transactions.hasCardCharges(state.transactionId())) {
            throw error(HttpStatus.CONFLICT, "CARD_PURCHASE_CORRECTION_REQUIRED",
                    "신용카드 구매는 기록 정정 또는 환불 처리로 변경해 주세요.");
        }
    }

    private TransactionJdbcRepository.TransactionWrite write(
            UUID id, LedgerMemberEntity author, CreateCommand command, TransactionType type,
            TransferSubtype subtype, UUID categoryId, UUID performerId, UUID primaryAssetId,
            List<TransactionJdbcRepository.PostingWrite> postings, Instant now
    ) {
        return new TransactionJdbcRepository.TransactionWrite(id, author.getBookId(), type, subtype,
                command.occurredOn(), command.amountWon(), categoryId, performerId,
                primaryAssetId, stripToNull(command.description()), command.excludedFromStatistics(),
                author.getId(), now, postings);
    }

    private List<TransactionJdbcRepository.InstallmentWrite> installments(
            LocalDate occurredOn, long amountWon, int count, CardSettingEntity setting
    ) {
        long base = amountWon / count;
        long remainder = amountWon % count;
        List<TransactionJdbcRepository.InstallmentWrite> result = new ArrayList<>(count);
        for (int index = 0; index < count; index++) {
            long amount = base + (index < remainder ? 1 : 0);
            if (amount <= 0) {
                throw installmentInvalid();
            }
            CardBillingCyclePolicy.Cycle cycle = billingCyclePolicy.calculate(
                    occurredOn.plusMonths(index), setting.getStatementClosingDay(),
                    setting.getPaymentDay(), setting.getPaymentMonthOffset(), assetLedger::isPublicHoliday);
            result.add(new TransactionJdbcRepository.InstallmentWrite(index + 1, amount, cycle));
        }
        return result;
    }

    private TransactionView requiredView(UUID bookId, UUID transactionId) {
        TransactionJdbcRepository.TransactionRows rows = transactions.find(bookId, transactionId);
        if (rows == null) {
            throw error(HttpStatus.NOT_FOUND, "TRANSACTION_NOT_FOUND", "거래를 찾을 수 없습니다.");
        }
        return toView(rows, transactions.findCardPaymentReference(bookId, transactionId));
    }

    private TransactionView toView(TransactionJdbcRepository.TransactionRows rows) {
        return toView(rows, null);
    }

    private TransactionView toView(
            TransactionJdbcRepository.TransactionRows rows,
            TransactionJdbcRepository.CardPaymentReferenceRow cardPayment
    ) {
        TransactionJdbcRepository.ReadRow row = rows.transaction();
        CategoryView category = row.categoryId() == null ? null
                : new CategoryView(row.categoryId(), row.categoryName());
        MemberView performer = row.performerId() == null ? null
                : new MemberView(row.performerId(), row.performerName());
        MemberView creator = row.creatorId() == null ? null
                : new MemberView(row.creatorId(), row.creatorName());
        AssetReferenceView asset = row.primaryAssetId() == null ? null
                : new AssetReferenceView(row.primaryAssetId(), row.primaryAssetName());
        TransactionManagementType managementType = managementType(row);
        return new TransactionView(row.transactionId(), row.type(), row.transferSubtype(), managementType,
                row.occurredOn(),
                row.amountWon(), category, performer, creator, asset, row.description(),
                row.excludedFromStatistics(),
                rows.postings().stream().map(posting -> new PostingView(
                        posting.assetId(), posting.assetName(), posting.deltaWon())).toList(),
                row.installmentCount(), row.relatedPurchaseTransactionId(),
                cardPayment == null ? null : new CardPaymentReferenceView(
                        cardPayment.statementId(), cardPayment.paymentId(), cardPayment.paymentType(),
                        cardPayment.statementVersion(), cardPayment.returnedAmountWon()),
                row.version(), row.createdAt(), row.updatedAt());
    }

    private TransactionManagementType managementType(TransactionJdbcRepository.ReadRow row) {
        if ("CARD_REFUND".equals(row.sourceType())) {
            return TransactionManagementType.CARD_REFUND;
        }
        if (row.installmentCount() != null) {
            return TransactionManagementType.CARD_PURCHASE;
        }
        if (!"MANUAL".equals(row.sourceType())
                || (row.type() == TransactionType.TRANSFER
                && row.transferSubtype() != TransferSubtype.NORMAL)) {
            return TransactionManagementType.SYSTEM;
        }
        return TransactionManagementType.GENERAL;
    }

    private LedgerMemberEntity currentMember(UUID userId) {
        return members.findByUserId(userId).orElseThrow(() -> error(
                HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다."));
    }

    private UUID requirePerformer(UUID bookId, UUID performerId) {
        return members.findByIdAndBookId(performerId, bookId).map(LedgerMemberEntity::getId)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "TRANSACTION_PERFORMER_INVALID",
                        "같은 가계부의 구성원을 선택해 주세요."));
    }

    private void requireOptionalPerformer(UUID bookId, UUID performerId) {
        if (performerId != null) {
            requirePerformer(bookId, performerId);
        }
    }

    private AssetEntity requireAsset(UUID bookId, UUID assetId) {
        return assets.findActiveForRead(assetId, bookId)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "TRANSACTION_ASSET_INVALID",
                        "같은 가계부의 활성 자산을 선택해 주세요."));
    }

    private AssetEntity requireTransferAsset(UUID bookId, UUID assetId) {
        AssetEntity asset = requireAsset(bookId, assetId);
        AssetTypeEntity type = requireAssetType(bookId, asset.getAssetTypeId());
        if (!TRANSFER_ASSET_SYSTEM_CODES.contains(type.getSystemCode())) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSFER_ACCOUNT_OR_SAVINGS_REQUIRED",
                    "이체에는 같은 가계부의 활성 계좌 또는 적금만 선택할 수 있어요.");
        }
        return asset;
    }

    private AssetTypeEntity requireAssetType(UUID bookId, UUID typeId) {
        return assetTypes.findByIdAndBookIdAndArchivedAtIsNull(typeId, bookId)
                .orElseThrow(() -> new IllegalStateException("asset type is missing"));
    }

    private CategoryEntity requireCategory(UUID bookId, UUID categoryId, CategoryKind kind) {
        CategoryEntity category = categories.findActiveForRead(categoryId, bookId)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "TRANSACTION_CATEGORY_INVALID",
                        "같은 가계부의 분류를 선택해 주세요."));
        requireActiveCategoryKind(category, kind);
        return category;
    }

    private CategoryEntity lockCategory(UUID bookId, UUID categoryId) {
        return categories.findForRead(categoryId, bookId)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "TRANSACTION_CATEGORY_INVALID",
                        "같은 가계부의 분류를 선택해 주세요."));
    }

    private void requireActiveCategoryKind(CategoryEntity category, CategoryKind kind) {
        if (category.getArchivedAt() != null || category.getKind() != kind) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_CATEGORY_INVALID",
                    "같은 가계부의 활성 분류를 거래 유형에 맞게 선택해 주세요.");
        }
    }

    private ApiException transactionNotFound() {
        return error(HttpStatus.NOT_FOUND, "TRANSACTION_NOT_FOUND", "거래를 찾을 수 없습니다.");
    }

    private void requireRange(LocalDate from, LocalDate toExclusive) {
        long days = ChronoUnit.DAYS.between(from, toExclusive);
        if (days < 1 || days > MAX_RANGE_DAYS) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_RANGE_INVALID",
                    "거래 조회 기간은 1일 이상 366일 이하여야 합니다.");
        }
    }

    private ApiException installmentInvalid() {
        return error(HttpStatus.BAD_REQUEST, "INSTALLMENT_INVALID",
                "할부 개월 수와 금액을 확인해 주세요.");
    }

    private ApiException error(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message);
    }

    private String stripToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public sealed interface CreateCommand permits CreateIncome, CreateExpense, CreateTransfer {
        LocalDate occurredOn();
        long amountWon();
        UUID performedByMemberId();
        String description();
        default boolean excludedFromStatistics() {
            return false;
        }
    }
    public record CreateIncome(LocalDate occurredOn, long amountWon, UUID categoryId, UUID assetId,
                               UUID performedByMemberId, String description,
                               boolean excludedFromStatistics) implements CreateCommand {
        public CreateIncome(LocalDate occurredOn, long amountWon, UUID categoryId, UUID assetId,
                            UUID performedByMemberId, String description) {
            this(occurredOn, amountWon, categoryId, assetId, performedByMemberId, description, false);
        }
    }
    public record CreateExpense(LocalDate occurredOn, long amountWon, UUID categoryId, UUID assetId,
                                UUID performedByMemberId, String description,
                                int installmentCount, boolean excludedFromStatistics) implements CreateCommand {
        public CreateExpense(LocalDate occurredOn, long amountWon, UUID categoryId, UUID assetId,
                             UUID performedByMemberId, String description, int installmentCount) {
            this(occurredOn, amountWon, categoryId, assetId, performedByMemberId,
                    description, installmentCount, false);
        }
    }
    public record CreateTransfer(LocalDate occurredOn, long amountWon, UUID sourceAssetId,
                                 UUID destinationAssetId, UUID performedByMemberId,
                                 String description) implements CreateCommand {
    }
    private record CardPurchase(AssetEntity asset, CardSettingEntity setting,
                                List<TransactionJdbcRepository.InstallmentWrite> installments) {
    }
    private record TransactionMutation(
            UUID categoryId,
            UUID primaryAssetId,
            List<TransactionJdbcRepository.PostingWrite> postings,
            CardPurchase cardPurchase
    ) {
    }
    public record UpdateCommand(
            TransactionType type,
            LocalDate occurredOn,
            long amountWon,
            UUID categoryId,
            UUID assetId,
            UUID sourceAssetId,
            UUID destinationAssetId,
            UUID performedByMemberId,
            String description,
            long expectedVersion,
            boolean excludedFromStatistics,
            int installmentCount
    ) {
        public UpdateCommand(
                TransactionType type, LocalDate occurredOn, long amountWon, UUID categoryId,
                UUID assetId, UUID sourceAssetId, UUID destinationAssetId,
                UUID performedByMemberId, String description, long expectedVersion
        ) {
            this(type, occurredOn, amountWon, categoryId, assetId, sourceAssetId,
                    destinationAssetId, performedByMemberId, description, expectedVersion, false, 1);
        }

        public UpdateCommand(
                TransactionType type, LocalDate occurredOn, long amountWon, UUID categoryId,
                UUID assetId, UUID sourceAssetId, UUID destinationAssetId,
                UUID performedByMemberId, String description, long expectedVersion,
                boolean excludedFromStatistics
        ) {
            this(type, occurredOn, amountWon, categoryId, assetId, sourceAssetId,
                    destinationAssetId, performedByMemberId, description, expectedVersion,
                    excludedFromStatistics, 1);
        }
    }
    public enum TransactionManagementType {
        GENERAL,
        CARD_PURCHASE,
        CARD_REFUND,
        SYSTEM
    }
    public record DaySummary(LocalDate date, long incomeWon, long expenseWon, long netWon) {
    }
    public record CalendarView(YearMonth month, long totalIncomeWon, long totalExpenseWon,
                               long netWon, List<DaySummary> days) {
    }
    public record CategoryView(UUID categoryId, String name) {
    }
    public record MemberView(UUID memberId, String displayName) {
    }
    public record AssetReferenceView(UUID assetId, String name) {
    }
    public record PostingView(UUID assetId, String assetName, long deltaWon) {
    }
    public record CardPaymentReferenceView(
            UUID statementId,
            UUID paymentId,
            String paymentType,
            long statementVersion,
            long returnedAmountWon
    ) {
    }
    public record TransactionView(UUID transactionId, TransactionType type, TransferSubtype transferSubtype,
                                  TransactionManagementType managementType,
                                  LocalDate occurredOn, long amountWon, CategoryView category,
                                  MemberView performedBy, MemberView createdBy, AssetReferenceView asset,
                                  String description,
                                  boolean excludedFromStatistics,
                                  List<PostingView> postings, Integer installmentCount,
                                  UUID relatedPurchaseTransactionId,
                                  CardPaymentReferenceView cardPayment,
                                  long version,
                                  Instant createdAt, Instant updatedAt) {
    }
    public record TransactionPage(List<TransactionView> items, String nextCursor) {
    }
    public record DeletedTransactionView(UUID transactionId, long deletedVersion) {
    }
}
