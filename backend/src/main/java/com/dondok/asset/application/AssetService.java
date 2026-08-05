package com.dondok.asset.application;

import com.dondok.asset.domain.AssetBehavior;
import com.dondok.asset.domain.AssetOwnershipScope;
import com.dondok.asset.domain.CardBillingCyclePolicy;
import com.dondok.asset.domain.DefaultAssetType;
import com.dondok.asset.infrastructure.persistence.AssetEntity;
import com.dondok.asset.infrastructure.persistence.AssetIdempotencyRepository;
import com.dondok.asset.infrastructure.persistence.AssetLedgerRepository;
import com.dondok.asset.infrastructure.persistence.AssetLedgerRepository.CardPaymentDues;
import com.dondok.asset.infrastructure.persistence.AssetRepository;
import com.dondok.asset.infrastructure.persistence.AssetRemovalRepository;
import com.dondok.asset.infrastructure.persistence.AssetRemovalRepository.LinkState;
import com.dondok.asset.infrastructure.persistence.AssetRemovalRepository.RemovalSnapshot;
import com.dondok.asset.infrastructure.persistence.AssetTypeEntity;
import com.dondok.asset.infrastructure.persistence.AssetTypeRepository;
import com.dondok.asset.infrastructure.persistence.CardSettingEntity;
import com.dondok.asset.infrastructure.persistence.CardSettingRepository;
import com.dondok.asset.infrastructure.persistence.DebitCardSettingEntity;
import com.dondok.asset.infrastructure.persistence.DebitCardSettingRepository;
import com.dondok.asset.infrastructure.persistence.SavingsSettingEntity;
import com.dondok.asset.infrastructure.persistence.SavingsSettingRepository;
import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

@Service
public class AssetService {
    private static final int ACTIVE_ASSET_LIMIT = 50;
    private static final ZoneId SERVICE_ZONE = ZoneId.of("Asia/Seoul");
    private static final CardPaymentDues NO_CARD_PAYMENT_DUES = new CardPaymentDues(0, 0);
    private static final Set<String> SYSTEM_ASSET_TYPE_CODES = DefaultAssetType.ALL.stream()
            .map(DefaultAssetType::systemCode)
            .collect(Collectors.toUnmodifiableSet());

    private final AssetRepository assets;
    private final AssetTypeRepository assetTypes;
    private final CardSettingRepository cardSettings;
    private final DebitCardSettingRepository debitCardSettings;
    private final SavingsSettingRepository savingsSettings;
    private final AssetLedgerRepository ledger;
    private final AssetRemovalRepository removalRepository;
    private final AssetIdempotencyRepository idempotency;
    private final LedgerMemberRepository members;
    private final LedgerMutationGuard mutationGuard;
    private final CardBillingCyclePolicy billingCyclePolicy;
    private final Clock clock;

    public AssetService(
            AssetRepository assets,
            AssetTypeRepository assetTypes,
            CardSettingRepository cardSettings,
            DebitCardSettingRepository debitCardSettings,
            SavingsSettingRepository savingsSettings,
            AssetLedgerRepository ledger,
            AssetRemovalRepository removalRepository,
            AssetIdempotencyRepository idempotency,
            LedgerMemberRepository members,
            LedgerMutationGuard mutationGuard,
            CardBillingCyclePolicy billingCyclePolicy,
            Clock clock
    ) {
        this.assets = assets;
        this.assetTypes = assetTypes;
        this.cardSettings = cardSettings;
        this.debitCardSettings = debitCardSettings;
        this.savingsSettings = savingsSettings;
        this.ledger = ledger;
        this.removalRepository = removalRepository;
        this.idempotency = idempotency;
        this.members = members;
        this.mutationGuard = mutationGuard;
        this.billingCyclePolicy = billingCyclePolicy;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<AssetTypeView> assetTypes(UUID userId) {
        LedgerMemberEntity member = currentMember(userId);
        return assetTypes.findAllByBookIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(member.getBookId())
                .stream().filter(this::isSystemAssetType).map(this::toView).toList();
    }

    @Transactional(readOnly = true)
    public List<AssetView> assets(UUID userId) {
        return assets(userId, AssetListStatus.ACTIVE);
    }

    @Transactional(readOnly = true)
    public List<AssetView> assets(UUID userId, AssetListStatus status) {
        LedgerMemberEntity member = currentMember(userId);
        List<AssetEntity> found = switch (status) {
            case ACTIVE -> assets.findAllByBookIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(member.getBookId());
            case ARCHIVED -> assets.findAllByBookIdAndArchivedAtIsNotNullOrderBySortOrderAscIdAsc(member.getBookId());
            case ALL -> assets.findAllByBookIdOrderBySortOrderAscIdAsc(member.getBookId());
        };
        return views(member.getBookId(), found);
    }

    @Transactional(readOnly = true)
    public AssetView asset(UUID userId, UUID assetId) {
        LedgerMemberEntity member = currentMember(userId);
        return view(member.getBookId(), anyAsset(member.getBookId(), assetId));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public AssetRemovalPreview removalPreview(UUID userId, UUID assetId) {
        LedgerMemberEntity member = currentMember(userId);
        AssetEntity asset = activeAsset(member.getBookId(), assetId);
        return removalPreview(asset, removalRepository.snapshot(member.getBookId(), assetId));
    }

    @Transactional
    public AssetRemovalResult remove(
            UUID userId,
            UUID assetId,
            long expectedVersion,
            String previewToken
    ) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMember(userId);
        AssetEntity asset = assets.findActiveForUpdate(assetId, member.getBookId())
                .orElseThrow(this::assetNotFound);
        if (asset.getVersion() != expectedVersion) {
            throw versionConflict();
        }
        removalRepository.lockRemovalState(member.getBookId(), assetId);
        RemovalSnapshot snapshot = removalRepository.snapshot(member.getBookId(), assetId);
        String currentToken = removalToken(asset, snapshot);
        if (!MessageDigest.isEqual(
                currentToken.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                previewToken.getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
            throw error(HttpStatus.PRECONDITION_FAILED, "ASSET_REMOVAL_PREVIEW_STALE",
                    "미리보기 이후 자산의 잔액, 이력 또는 연결 상태가 변경되었습니다.");
        }
        List<AssetRemovalBlockingLink> blockers = blockingLinkViews(snapshot);
        if (!blockers.isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "ASSET_LINKED_AS_PAYMENT_SOURCE",
                    "연결된 카드나 적금의 계좌를 먼저 변경해 주세요.",
                    Map.of("blockingLinks", blockers));
        }

        Instant removedAt = clock.instant();
        String name = asset.getName();
        long currentBalanceWon = snapshot.currentBalanceWon();
        if (snapshot.requiresArchive()) {
            asset.archive(member.getId(), removedAt);
            assets.flush();
            return new AssetRemovalResult(
                    assetId, name, AssetRemovalResultDisposition.ARCHIVED,
                    currentBalanceWon, removedAt);
        }

        assets.delete(asset);
        assets.flush();
        return new AssetRemovalResult(
                assetId, name, AssetRemovalResultDisposition.DELETED,
                currentBalanceWon, removedAt);
    }

    @Transactional
    public AssetView create(UUID userId, String idempotencyKey, AssetCommand command) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMemberExclusively(userId);
        Instant now = clock.instant();
        String requestHash = requestHash(command);
        AssetIdempotencyRepository.Claim claim = idempotency.claim(
                userId, member.getBookId(), idempotencyKey, requestHash, now);
        if (!claim.fresh()) {
            if (!claim.requestHash().equals(requestHash)) {
                throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                        "같은 중복 방지 키를 다른 요청에 사용할 수 없습니다.");
            }
            if ("COMPLETED".equals(claim.status()) && claim.resourceId() != null) {
                return view(member.getBookId(), activeAsset(member.getBookId(), claim.resourceId()));
            }
            throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                    "동일한 자산 등록 요청이 처리 중입니다.");
        }

        if (assets.countByBookIdAndArchivedAtIsNull(member.getBookId()) >= ACTIVE_ASSET_LIMIT) {
            throw error(HttpStatus.CONFLICT, "ASSET_LIMIT_EXCEEDED", "활성 자산은 50개까지 등록할 수 있습니다.");
        }
        requireAvailableName(member.getBookId(), command.name(), null);
        AssetTypeEntity type = resolveType(member.getBookId(), command.assetTypeId());
        UUID ownerMemberId = validateOwner(member.getBookId(), command.ownershipScope(), command.ownerMemberId());
        CardSettingsCommand cardCommand = validateCardSettings(
                member.getBookId(), null, type, command.cardSettings());
        DebitCardSettingsCommand debitCommand = validateDebitCardSettings(
                member.getBookId(), null, type, command.debitCardSettings());
        SavingsSettingsCommand savingsCommand = validateSavingsSettings(
                member.getBookId(), null, type, command.savingsSettings());
        requireOpeningMagnitude(command.openingBalanceWon());

        UUID assetId = UuidV7.next();
        AssetEntity asset = assets.save(new AssetEntity(
                assetId, member.getBookId(), type.getId(), command.ownershipScope(), ownerMemberId,
                command.name().strip(), command.openedOn(), stripToNull(command.memo()), 0, member.getId(), now));
        assets.flush();
        CardSettingEntity setting = synchronizeCardSetting(asset, type, cardCommand, now);
        synchronizeDebitCardSetting(asset, type, debitCommand, now);
        synchronizeSavingsSetting(asset, type, savingsCommand, now);
        UUID openingTransactionId = ledger.synchronizeOpeningBalance(
                member.getBookId(), assetId, member.getId(), command.openedOn(),
                command.openingBalanceWon(), now);
        synchronizeCardOpening(asset, type, setting, openingTransactionId, command.openingBalanceWon(), now);
        ledger.synchronizeCardPaymentSchedules(member.getBookId(), assetId, setting, now);
        idempotency.complete(userId, idempotencyKey, assetId, now);
        return view(member.getBookId(), asset);
    }

    @Transactional
    public AssetView update(UUID userId, UUID assetId, UpdateAssetCommand command) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMember(userId);
        AssetEntity asset = activeAsset(member.getBookId(), assetId);
        if (asset.getVersion() != command.expectedVersion()) {
            throw versionConflict();
        }
        AssetCommand input = command.input();
        boolean ownerChanged = asset.getOwnershipScope() != input.ownershipScope()
                || !Objects.equals(asset.getOwnerMemberId(), input.ownerMemberId());
        if (command.reassignTransactionsToNewOwner()
                && (!ownerChanged || input.ownershipScope() != AssetOwnershipScope.PERSONAL)) {
            throw error(HttpStatus.BAD_REQUEST, "OWNER_REASSIGNMENT_NOT_APPLICABLE",
                    "개인 소유자가 변경될 때만 기존 수입·지출의 구성원을 변경할 수 있습니다.");
        }
        Instant now = clock.instant();
        requireAvailableName(member.getBookId(), input.name(), assetId);
        AssetTypeEntity type = resolveType(member.getBookId(), input.assetTypeId());
        requirePaymentSourceCapability(assetId, type);
        UUID ownerMemberId = validateOwner(member.getBookId(), input.ownershipScope(), input.ownerMemberId());
        CardSettingsCommand cardCommand = validateCardSettings(
                member.getBookId(), assetId, type, input.cardSettings());
        DebitCardSettingsCommand debitCommand = validateDebitCardSettings(
                member.getBookId(), assetId, type, input.debitCardSettings());
        SavingsSettingsCommand savingsCommand = validateSavingsSettings(
                member.getBookId(), assetId, type, input.savingsSettings());
        requireOpeningMagnitude(input.openingBalanceWon());

        asset.update(type.getId(), input.ownershipScope(), ownerMemberId, input.name().strip(),
                input.openedOn(), stripToNull(input.memo()), member.getId(), now);
        assets.flush();
        CardSettingEntity setting = synchronizeCardSetting(asset, type, cardCommand, now);
        synchronizeDebitCardSetting(asset, type, debitCommand, now);
        synchronizeSavingsSetting(asset, type, savingsCommand, now);
        UUID openingTransactionId = ledger.synchronizeOpeningBalance(
                member.getBookId(), assetId, member.getId(), input.openedOn(),
                input.openingBalanceWon(), now);
        synchronizeCardOpening(asset, type, setting, openingTransactionId, input.openingBalanceWon(), now);
        ledger.synchronizeCardPaymentSchedules(member.getBookId(), assetId, setting, now);
        if (command.reassignTransactionsToNewOwner()) {
            ledger.reassignTransactionPerformers(member.getBookId(), assetId, ownerMemberId, member.getId(), now);
        }
        return view(member.getBookId(), asset);
    }

    private AssetTypeEntity resolveType(UUID bookId, UUID assetTypeId) {
        return assetTypes.findByIdAndBookIdAndArchivedAtIsNull(assetTypeId, bookId)
                .filter(this::isSystemAssetType)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "ASSET_TYPE_INVALID",
                        "고정 자산 종류에서 선택해 주세요."));
    }

    private boolean isSystemAssetType(AssetTypeEntity type) {
        return SYSTEM_ASSET_TYPE_CODES.contains(type.getSystemCode());
    }

    private UUID validateOwner(UUID bookId, AssetOwnershipScope scope, UUID ownerMemberId) {
        if (scope == AssetOwnershipScope.JOINT) {
            if (ownerMemberId != null) {
                throw error(HttpStatus.BAD_REQUEST, "ASSET_OWNER_INVALID",
                        "공동 소유 자산에는 개인 소유자를 지정할 수 없습니다.");
            }
            return null;
        }
        if (ownerMemberId == null || members.findByIdAndBookId(ownerMemberId, bookId).isEmpty()) {
            throw error(HttpStatus.BAD_REQUEST, "ASSET_OWNER_INVALID",
                    "같은 가계부의 구성원을 소유자로 선택해 주세요.");
        }
        return ownerMemberId;
    }

    private CardSettingsCommand validateCardSettings(
            UUID bookId, UUID cardAssetId, AssetTypeEntity type, CardSettingsCommand command
    ) {
        if (type.getBehavior() == AssetBehavior.CREDIT_CARD && command == null) {
            throw error(HttpStatus.BAD_REQUEST, "CARD_SETTINGS_REQUIRED",
                    "신용카드의 정산일, 결제일과 결제 계좌를 입력해 주세요.");
        }
        if (type.getBehavior() != AssetBehavior.CREDIT_CARD && command != null) {
            throw error(HttpStatus.BAD_REQUEST, "CARD_SETTINGS_NOT_ALLOWED",
                    "신용카드 유형만 카드 설정을 사용할 수 있습니다.");
        }
        if (command == null) {
            return null;
        }
        if (command.settlementAssetId() == null) {
            throw invalidSettlementAsset();
        }
        if (command.settlementAssetId().equals(cardAssetId)) {
            throw invalidSettlementAsset();
        }
        AssetEntity settlement = assets.findActiveForRead(
                command.settlementAssetId(), bookId).orElseThrow(this::invalidSettlementAsset);
        AssetTypeEntity settlementType = assetTypes.findByIdAndBookIdAndArchivedAtIsNull(
                settlement.getAssetTypeId(), bookId).orElseThrow(this::invalidSettlementAsset);
        if (!settlementType.isPaymentSourceCapable()) {
            throw invalidSettlementAsset();
        }
        return command;
    }

    private DebitCardSettingsCommand validateDebitCardSettings(
            UUID bookId, UUID debitCardAssetId, AssetTypeEntity type, DebitCardSettingsCommand command
    ) {
        if (type.getBehavior() == AssetBehavior.DEBIT_CARD && command == null) {
            throw error(HttpStatus.BAD_REQUEST, "DEBIT_CARD_SETTINGS_REQUIRED",
                    "체크카드의 결제 계좌를 입력해 주세요.");
        }
        if (type.getBehavior() != AssetBehavior.DEBIT_CARD && command != null) {
            throw error(HttpStatus.BAD_REQUEST, "DEBIT_CARD_SETTINGS_NOT_ALLOWED",
                    "체크카드 유형만 체크카드 설정을 사용할 수 있습니다.");
        }
        if (command == null) {
            return null;
        }
        requireLinkedPaymentAsset(bookId, debitCardAssetId, command.paymentAssetId(),
                "DEBIT_CARD_PAYMENT_ASSET_INVALID", "같은 가계부의 결제 가능한 계좌를 선택해 주세요.");
        return command;
    }

    private SavingsSettingsCommand validateSavingsSettings(
            UUID bookId, UUID savingsAssetId, AssetTypeEntity type, SavingsSettingsCommand command
    ) {
        if (type.getBehavior() != AssetBehavior.SAVINGS && command != null) {
            throw error(HttpStatus.BAD_REQUEST, "SAVINGS_SETTINGS_NOT_ALLOWED",
                    "적금 유형만 적금 설정을 사용할 수 있습니다.");
        }
        if (command == null) {
            return null;
        }
        if (command.transferDay() < 1 || command.transferDay() > 31) {
            throw error(HttpStatus.BAD_REQUEST, "SAVINGS_TRANSFER_DAY_INVALID",
                    "자동이체일은 1일부터 31일 사이여야 합니다.");
        }
        requireLinkedPaymentAsset(bookId, savingsAssetId, command.transferAssetId(),
                "SAVINGS_TRANSFER_ASSET_INVALID", "같은 가계부의 자동이체 계좌를 선택해 주세요.");
        return command;
    }

    private void requireLinkedPaymentAsset(
            UUID bookId, UUID configuredAssetId, UUID linkedAssetId, String errorCode, String message
    ) {
        if (linkedAssetId == null || linkedAssetId.equals(configuredAssetId)) {
            throw error(HttpStatus.BAD_REQUEST, errorCode, message);
        }
        AssetEntity linkedAsset = assets.findActiveForRead(linkedAssetId, bookId)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, errorCode, message));
        AssetTypeEntity linkedType = assetTypes.findByIdAndBookIdAndArchivedAtIsNull(
                linkedAsset.getAssetTypeId(), bookId)
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, errorCode, message));
        if (!linkedType.isPaymentSourceCapable()) {
            throw error(HttpStatus.BAD_REQUEST, errorCode, message);
        }
    }

    private CardSettingEntity synchronizeCardSetting(
            AssetEntity asset, AssetTypeEntity type, CardSettingsCommand command, Instant now
    ) {
        CardSettingEntity existing = cardSettings.findById(asset.getId()).orElse(null);
        if (type.getBehavior() != AssetBehavior.CREDIT_CARD) {
            if (existing != null) {
                cardSettings.delete(existing);
                cardSettings.flush();
            }
            return null;
        }
        if (existing == null) {
            existing = new CardSettingEntity(asset.getId(), asset.getBookId(),
                    (short) command.statementClosingDay(), (short) command.paymentDay(),
                    (short) command.paymentMonthOffset(), command.settlementAssetId(),
                    command.autoSettlementEnabled(), now);
            cardSettings.save(existing);
        } else {
            existing.update((short) command.statementClosingDay(), (short) command.paymentDay(),
                    (short) command.paymentMonthOffset(), command.settlementAssetId(),
                    command.autoSettlementEnabled(), now);
        }
        cardSettings.flush();
        return existing;
    }

    private void synchronizeDebitCardSetting(
            AssetEntity asset, AssetTypeEntity type, DebitCardSettingsCommand command, Instant now
    ) {
        DebitCardSettingEntity existing = debitCardSettings.findById(asset.getId()).orElse(null);
        if (type.getBehavior() != AssetBehavior.DEBIT_CARD) {
            if (existing != null) {
                debitCardSettings.delete(existing);
                debitCardSettings.flush();
            }
            return;
        }
        if (existing == null) {
            debitCardSettings.save(new DebitCardSettingEntity(
                    asset.getId(), asset.getBookId(), command.paymentAssetId(), now));
        } else {
            existing.update(command.paymentAssetId(), now);
        }
        debitCardSettings.flush();
    }

    private void synchronizeSavingsSetting(
            AssetEntity asset, AssetTypeEntity type, SavingsSettingsCommand command, Instant now
    ) {
        SavingsSettingEntity existing = savingsSettings.findById(asset.getId()).orElse(null);
        if (type.getBehavior() != AssetBehavior.SAVINGS || command == null) {
            if (existing != null) {
                savingsSettings.delete(existing);
                savingsSettings.flush();
            }
            return;
        }
        if (existing == null) {
            savingsSettings.save(new SavingsSettingEntity(
                    asset.getId(), asset.getBookId(), command.transferAssetId(),
                    (short) command.transferDay(), now));
        } else {
            existing.update(command.transferAssetId(), (short) command.transferDay(), now);
        }
        savingsSettings.flush();
    }

    private void synchronizeCardOpening(
            AssetEntity asset, AssetTypeEntity type, CardSettingEntity setting,
            UUID transactionId, long openingBalanceWon, Instant now
    ) {
        CardBillingCyclePolicy.Cycle cycle = null;
        if (type.getBehavior() == AssetBehavior.CREDIT_CARD && openingBalanceWon < 0) {
            cycle = billingCyclePolicy.calculate(asset.getOpenedOn(), setting.getStatementClosingDay(),
                    setting.getPaymentDay(), setting.getPaymentMonthOffset(), ledger::isPublicHoliday);
        }
        ledger.synchronizeCardOpening(
                asset.getBookId(), asset.getId(), transactionId, openingBalanceWon, setting, cycle, now);
    }

    private List<AssetView> views(UUID bookId, List<AssetEntity> found) {
        if (found.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = found.stream().map(AssetEntity::getId).toList();
        Map<UUID, AssetTypeEntity> types = assetTypes.findAllById(
                        found.stream().map(AssetEntity::getAssetTypeId).distinct().toList()).stream()
                .collect(Collectors.toMap(AssetTypeEntity::getId, Function.identity()));
        Map<UUID, CardSettingEntity> settings = cardSettings.findAllByCardAssetIdIn(ids).stream()
                .collect(Collectors.toMap(CardSettingEntity::getCardAssetId, Function.identity()));
        Map<UUID, DebitCardSettingEntity> debitSettings = debitCardSettings
                .findAllByDebitCardAssetIdIn(ids).stream()
                .collect(Collectors.toMap(DebitCardSettingEntity::getDebitCardAssetId, Function.identity()));
        Map<UUID, SavingsSettingEntity> savingsSettingsByAsset = savingsSettings
                .findAllBySavingsAssetIdIn(ids).stream()
                .collect(Collectors.toMap(SavingsSettingEntity::getSavingsAssetId, Function.identity()));
        Map<UUID, Long> opening = ledger.openingBalances(bookId, ids);
        Map<UUID, Long> balances = ledger.currentBalances(bookId);
        List<UUID> cardIds = found.stream()
                .filter(asset -> requiredType(types, asset.getAssetTypeId()).getBehavior()
                        == AssetBehavior.CREDIT_CARD)
                .map(AssetEntity::getId)
                .toList();
        Map<UUID, CardPaymentDues> cardPaymentDues = currentAndNextMonthCardPaymentDues(bookId, cardIds);
        return found.stream().map(asset -> toView(asset, requiredType(types, asset.getAssetTypeId()),
                settings.get(asset.getId()), debitSettings.get(asset.getId()),
                savingsSettingsByAsset.get(asset.getId()), opening.getOrDefault(asset.getId(), 0L),
                balances.getOrDefault(asset.getId(), 0L),
                cardPaymentDues.getOrDefault(asset.getId(), NO_CARD_PAYMENT_DUES))).toList();
    }

    private AssetView view(UUID bookId, AssetEntity asset) {
        AssetTypeEntity type = assetTypes.findByIdAndBookIdAndArchivedAtIsNull(
                asset.getAssetTypeId(), bookId).orElseThrow(() -> new IllegalStateException("asset type is missing"));
        CardPaymentDues cardPaymentDues = currentAndNextMonthCardPaymentDues(
                bookId,
                type.getBehavior() == AssetBehavior.CREDIT_CARD ? List.of(asset.getId()) : List.of())
                .getOrDefault(asset.getId(), NO_CARD_PAYMENT_DUES);
        return toView(asset, type, cardSettings.findById(asset.getId()).orElse(null),
                debitCardSettings.findById(asset.getId()).orElse(null),
                savingsSettings.findById(asset.getId()).orElse(null),
                ledger.openingBalance(bookId, asset.getId()), ledger.currentBalance(bookId, asset.getId()),
                cardPaymentDues);
    }

    private Map<UUID, CardPaymentDues> currentAndNextMonthCardPaymentDues(
            UUID bookId,
            List<UUID> cardAssetIds
    ) {
        LocalDate monthStart = clock.instant().atZone(SERVICE_ZONE).toLocalDate().withDayOfMonth(1);
        LocalDate nextMonthStart = monthStart.plusMonths(1);
        return ledger.cardPaymentDues(
                bookId, cardAssetIds, monthStart, nextMonthStart, nextMonthStart.plusMonths(1));
    }

    private AssetView toView(
                             AssetEntity asset, AssetTypeEntity type, CardSettingEntity setting,
                             DebitCardSettingEntity debitSetting, SavingsSettingEntity savingsSetting,
                             long openingBalanceWon, long currentBalanceWon,
                             CardPaymentDues cardPaymentDues) {
        return new AssetView(asset.getId(), type.getId(), type.getSystemCode(), type.getName(), type.getBehavior(),
                type.isPaymentSourceCapable(), asset.getOwnershipScope(), asset.getOwnerMemberId(),
                asset.getName(), asset.getOpenedOn(), asset.getMemo(), openingBalanceWon,
                currentBalanceWon, cardPaymentDues.currentMonthWon(), cardPaymentDues.nextMonthWon(),
                asset.isArchived() ? AssetStatus.ARCHIVED : AssetStatus.ACTIVE, asset.getArchivedAt(),
                asset.getVersion(),
                setting == null ? null : new CardSettingsView(
                setting.getStatementClosingDay(), setting.getPaymentDay(), setting.getPaymentMonthOffset(),
                setting.getSettlementAssetId(), setting.isAutoSettlementEnabled()),
                debitSetting == null ? null : new DebitCardSettingsView(debitSetting.getPaymentAssetId()),
                savingsSetting == null ? null : new SavingsSettingsView(
                        savingsSetting.getTransferAssetId(), savingsSetting.getTransferDay()));
    }

    private AssetTypeView toView(AssetTypeEntity type) {
        return new AssetTypeView(type.getId(), type.getSystemCode(), type.getName(), type.getBehavior(),
                type.isPaymentSourceCapable());
    }

    private LedgerMemberEntity currentMember(UUID userId) {
        return members.findByUserId(userId).orElseThrow(this::ledgerNotFound);
    }

    private AssetEntity activeAsset(UUID bookId, UUID assetId) {
        return assets.findByIdAndBookIdAndArchivedAtIsNull(assetId, bookId)
                .orElseThrow(this::assetNotFound);
    }

    private AssetEntity anyAsset(UUID bookId, UUID assetId) {
        return assets.findByIdAndBookId(assetId, bookId).orElseThrow(this::assetNotFound);
    }

    private ApiException assetNotFound() {
        return error(HttpStatus.NOT_FOUND, "ASSET_NOT_FOUND", "자산을 찾을 수 없습니다.");
    }

    private AssetRemovalPreview removalPreview(AssetEntity asset, RemovalSnapshot snapshot) {
        return new AssetRemovalPreview(
                asset.getId(), asset.getName(),
                snapshot.requiresArchive() ? AssetRemovalDisposition.ARCHIVE : AssetRemovalDisposition.DELETE,
                snapshot.currentBalanceWon(), snapshot.historyTransactionCount(),
                snapshot.unpaidStatements().size(), blockingLinkViews(snapshot),
                asset.getVersion(), removalToken(asset, snapshot));
    }

    private List<AssetRemovalBlockingLink> blockingLinkViews(RemovalSnapshot snapshot) {
        Map<String, AssetRemovalBlockingLink> unique = new LinkedHashMap<>();
        for (LinkState state : snapshot.blockingLinks()) {
            AssetRemovalBlockingLink link = new AssetRemovalBlockingLink(
                    AssetRemovalBlockingLinkKind.valueOf(state.kind()),
                    state.assetId(), state.assetName());
            unique.putIfAbsent(link.kind() + ":" + link.assetId(), link);
        }
        return List.copyOf(unique.values());
    }

    private String removalToken(AssetEntity asset, RemovalSnapshot snapshot) {
        return sha256(asset.getId() + "|" + asset.getVersion() + "|" + snapshot.canonicalState());
    }

    private AssetTypeEntity requiredType(Map<UUID, AssetTypeEntity> types, UUID typeId) {
        AssetTypeEntity type = types.get(typeId);
        if (type == null) {
            throw new IllegalStateException("asset type is missing");
        }
        return type;
    }

    private void requireAvailableName(UUID bookId, String name, UUID excludedId) {
        boolean exists = excludedId == null
                ? assets.existsByBookIdAndNameIgnoreCaseAndArchivedAtIsNull(bookId, name.strip())
                : assets.existsByBookIdAndNameIgnoreCaseAndArchivedAtIsNullAndIdNot(
                        bookId, name.strip(), excludedId);
        if (exists) {
            throw error(HttpStatus.CONFLICT, "ASSET_NAME_ALREADY_EXISTS", "같은 이름의 자산이 이미 있습니다.");
        }
    }

    private void requireOpeningMagnitude(long value) {
        if (value == Long.MIN_VALUE) {
            throw error(HttpStatus.BAD_REQUEST, "OPENING_BALANCE_INVALID", "최초 금액의 범위를 확인해 주세요.");
        }
    }

    private void requirePaymentSourceCapability(UUID assetId, AssetTypeEntity newType) {
        if (newType.isPaymentSourceCapable()) {
            return;
        }
        if (cardSettings.existsBySettlementAssetId(assetId)
                || debitCardSettings.existsByPaymentAssetId(assetId)
                || savingsSettings.existsByTransferAssetId(assetId)) {
            throw error(HttpStatus.CONFLICT, "ASSET_LINKED_AS_PAYMENT_SOURCE",
                    "연결된 카드나 적금의 계좌를 먼저 변경해 주세요.");
        }
    }

    private String requestHash(AssetCommand command) {
        StringBuilder canonical = new StringBuilder();
        appendHashPart(canonical, command.assetTypeId());
        appendHashPart(canonical, command.ownershipScope());
        appendHashPart(canonical, command.ownerMemberId());
        appendHashPart(canonical, command.name().strip());
        appendHashPart(canonical, command.openedOn());
        appendHashPart(canonical, stripToNull(command.memo()));
        appendHashPart(canonical, command.openingBalanceWon());
        CardSettingsCommand card = command.cardSettings();
        appendHashPart(canonical, card == null ? null : card.statementClosingDay());
        appendHashPart(canonical, card == null ? null : card.paymentDay());
        appendHashPart(canonical, card == null ? null : card.paymentMonthOffset());
        appendHashPart(canonical, card == null ? null : card.settlementAssetId());
        appendHashPart(canonical, card == null ? null : card.autoSettlementEnabled());
        DebitCardSettingsCommand debit = command.debitCardSettings();
        appendHashPart(canonical, debit == null ? null : debit.paymentAssetId());
        SavingsSettingsCommand savings = command.savingsSettings();
        appendHashPart(canonical, savings == null ? null : savings.transferAssetId());
        appendHashPart(canonical, savings == null ? null : savings.transferDay());
        return sha256(canonical.toString());
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private void appendHashPart(StringBuilder target, Object value) {
        if (value == null) {
            target.append("-1:");
            return;
        }
        String text = value.toString();
        target.append(text.length()).append(':').append(text);
    }

    private String stripToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private ApiException invalidSettlementAsset() {
        return error(HttpStatus.BAD_REQUEST, "CARD_SETTLEMENT_ASSET_INVALID",
                "같은 가계부의 결제 가능한 자산을 선택해 주세요.");
    }

    private ApiException ledgerNotFound() {
        return error(HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다.");
    }

    private ApiException versionConflict() {
        return error(HttpStatus.PRECONDITION_FAILED, "VERSION_CONFLICT",
                "편집하는 동안 자산이 변경되었습니다.");
    }

    private ApiException error(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message);
    }

    public record AssetTypeView(UUID assetTypeId, String systemCode, String name, AssetBehavior behavior,
                                boolean paymentSourceCapable) {
    }

    public record CardSettingsCommand(int statementClosingDay, int paymentDay, int paymentMonthOffset,
                                      UUID settlementAssetId, boolean autoSettlementEnabled) {
    }

    public record DebitCardSettingsCommand(UUID paymentAssetId) {
    }

    public record SavingsSettingsCommand(UUID transferAssetId, int transferDay) {
    }

    public record AssetCommand(UUID assetTypeId, AssetOwnershipScope ownershipScope,
                               UUID ownerMemberId, String name,
                               LocalDate openedOn, String memo, long openingBalanceWon,
                               CardSettingsCommand cardSettings,
                               DebitCardSettingsCommand debitCardSettings,
                               SavingsSettingsCommand savingsSettings) {
        public AssetCommand(
                UUID assetTypeId, AssetOwnershipScope ownershipScope, UUID ownerMemberId,
                String name, LocalDate openedOn, String memo, long openingBalanceWon,
                CardSettingsCommand cardSettings
        ) {
            this(assetTypeId, ownershipScope, ownerMemberId, name, openedOn, memo,
                    openingBalanceWon, cardSettings, null, null);
        }
    }

    public record UpdateAssetCommand(AssetCommand input, long expectedVersion,
                                     boolean reassignTransactionsToNewOwner) {
    }

    public record CardSettingsView(int statementClosingDay, int paymentDay, int paymentMonthOffset,
                                   UUID settlementAssetId, boolean autoSettlementEnabled) {
    }

    public record DebitCardSettingsView(UUID paymentAssetId) {
    }

    public record SavingsSettingsView(UUID transferAssetId, int transferDay) {
    }

    public enum AssetListStatus { ACTIVE, ARCHIVED, ALL }

    public enum AssetStatus { ACTIVE, ARCHIVED }

    public enum AssetRemovalDisposition { DELETE, ARCHIVE }

    public enum AssetRemovalResultDisposition { DELETED, ARCHIVED }

    public enum AssetRemovalBlockingLinkKind {
        CREDIT_CARD_SETTLEMENT, DEBIT_CARD_PAYMENT, SAVINGS_TRANSFER, CARD_PAYMENT_SCHEDULE
    }

    public record AssetRemovalBlockingLink(
            AssetRemovalBlockingLinkKind kind,
            UUID assetId,
            String assetName
    ) {
    }

    public record AssetRemovalPreview(
            UUID assetId,
            String name,
            AssetRemovalDisposition disposition,
            long currentBalanceWon,
            long historyTransactionCount,
            long unpaidCardStatementCount,
            List<AssetRemovalBlockingLink> blockingLinks,
            long expectedVersion,
            String previewToken
    ) {
    }

    public record AssetRemovalResult(
            UUID assetId,
            String name,
            AssetRemovalResultDisposition disposition,
            long currentBalanceWon,
            Instant removedAt
    ) {
    }

    public record AssetView(UUID assetId, UUID assetTypeId, String systemCode,
                            String assetTypeName, AssetBehavior behavior,
                            boolean paymentSourceCapable, AssetOwnershipScope ownershipScope,
                            UUID ownerMemberId, String name, LocalDate openedOn, String memo,
                            long openingBalanceWon, long currentBalanceWon,
                            long currentMonthCardPaymentDueWon, long nextMonthCardPaymentDueWon,
                            AssetStatus status, Instant archivedAt,
                            long version,
                            CardSettingsView cardSettings, DebitCardSettingsView debitCardSettings,
                            SavingsSettingsView savingsSettings) {
    }
}
