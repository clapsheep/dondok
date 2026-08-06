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
import com.dondok.category.domain.CategoryKind;
import com.dondok.category.infrastructure.persistence.CategoryEntity;
import com.dondok.category.infrastructure.persistence.CategoryRepository;
import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import com.dondok.transaction.domain.TransactionType;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.AccountAmount;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.AnchorSettlement;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.ChargeAllocation;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.ChargeIdHolder;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.ChargeRow;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.HistoricalRefundTarget;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.InstallmentTarget;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.PaymentAllocation;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.PaymentReduction;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.PaymentRow;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.PurchaseGraph;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.RefundRow;
import com.dondok.transaction.infrastructure.persistence.CardPurchaseManagementRepository.StatementRow;
import com.dondok.transaction.infrastructure.persistence.TransactionIdempotencyRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CardPurchaseManagementService {
    private static final int MAX_INSTALLMENTS = 60;
    private static final String CORRECTION_SCOPE =
            "POST:/api/transactions/{purchaseId}/card-purchase-corrections";
    private static final String REFUND_SCOPE =
            "POST:/api/transactions/{purchaseId}/card-purchase-refunds";

    private final CardPurchaseManagementRepository repository;
    private final TransactionService transactionService;
    private final TransactionIdempotencyRepository idempotency;
    private final LedgerMemberRepository members;
    private final LedgerMutationGuard mutationGuard;
    private final AssetRepository assets;
    private final AssetTypeRepository assetTypes;
    private final CardSettingRepository cardSettings;
    private final CategoryRepository categories;
    private final AssetLedgerRepository assetLedger;
    private final CardBillingCyclePolicy billingCyclePolicy;
    private final Clock clock;

    public CardPurchaseManagementService(
            CardPurchaseManagementRepository repository,
            TransactionService transactionService,
            TransactionIdempotencyRepository idempotency,
            LedgerMemberRepository members,
            LedgerMutationGuard mutationGuard,
            AssetRepository assets,
            AssetTypeRepository assetTypes,
            CardSettingRepository cardSettings,
            CategoryRepository categories,
            AssetLedgerRepository assetLedger,
            CardBillingCyclePolicy billingCyclePolicy,
            Clock clock
    ) {
        this.repository = repository;
        this.transactionService = transactionService;
        this.idempotency = idempotency;
        this.members = members;
        this.mutationGuard = mutationGuard;
        this.assets = assets;
        this.assetTypes = assetTypes;
        this.cardSettings = cardSettings;
        this.categories = categories;
        this.assetLedger = assetLedger;
        this.billingCyclePolicy = billingCyclePolicy;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CardPurchaseManagementView management(UUID userId, UUID purchaseId) {
        LedgerMemberEntity member = currentMember(userId);
        PurchaseGraph graph = requirePurchase(repository.find(member.getBookId(), purchaseId));
        return toManagement(userId, graph);
    }

    @Transactional(readOnly = true)
    public CardPurchaseRefundPreview previewRefund(
            UUID userId,
            UUID purchaseId,
            RefundCommand command
    ) {
        LedgerMemberEntity member = currentMember(userId);
        PurchaseGraph graph = requirePurchase(repository.find(member.getBookId(), purchaseId));
        requireVersion(graph, command.expectedVersion());
        AnchorSettlement anchor = repository.findAnchorSettlement(
                member.getBookId(), graph.purchase().cardAssetId(), false);
        RefundPlan plan = refundPlan(graph, anchor, command.amountWon());
        return new CardPurchaseRefundPreview(
                refundPreviewToken(graph, anchor, command), graph.purchase().version(),
                graph.refundableAmountWon(), plan.unpaidCardReductionWon(),
                accountReturnViews(plan.accountReturns()));
    }

    @Transactional
    public CardPurchaseRefundResult refund(
            UUID userId,
            UUID purchaseId,
            String idempotencyKey,
            RefundApplyCommand command
    ) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMember(userId);
        Instant now = clock.instant();
        String requestHash = hash(purchaseId + "|" + command);
        TransactionIdempotencyRepository.Claim claim = idempotency.claim(
                userId, member.getBookId(), REFUND_SCOPE, idempotencyKey, requestHash, now);
        if (!claim.fresh()) {
            requireReplayRequest(claim, requestHash);
            if ("COMPLETED".equals(claim.status()) && claim.resourceId() != null) {
                PurchaseGraph current = requirePurchase(repository.find(member.getBookId(), purchaseId));
                RefundRow refund = current.refunds().stream()
                        .filter(row -> row.refundTransactionId().equals(claim.resourceId()))
                        .findFirst().orElseThrow(this::refundNotFound);
                return refundResult(userId, current, refund);
            }
            throw idempotencyInProgress();
        }

        PurchaseGraph graph = requirePurchase(repository.findForUpdate(member.getBookId(), purchaseId));
        requireVersion(graph, command.expectedVersion());
        AnchorSettlement anchor = repository.findAnchorSettlement(
                member.getBookId(), graph.purchase().cardAssetId(), true);
        String currentToken = refundPreviewToken(graph, anchor, command.toPreviewCommand());
        requirePreviewToken(command.previewToken(), currentToken);
        RefundPlan plan = refundPlan(graph, anchor, command.amountWon());
        UUID refundId = UuidV7.next();
        UUID refundTransactionId = UuidV7.next();
        repository.insertRefund(
                new CardPurchaseManagementRepository.RefundWrite(
                        refundId, refundTransactionId, purchaseId, member.getBookId(),
                        graph.purchase().cardAssetId(), graph.purchase().categoryId(),
                        graph.purchase().performedByMemberId(), member.getId(),
                        command.refundedOn(), command.amountWon(), stripToNull(command.description()),
                        command.excludedFromStatistics(), command.expectedVersion(), now),
                plan.chargeAllocations(), plan.paymentAllocations(),
                plan.accountReturns(), plan.unpaidCardReductionWon());
        idempotency.complete(userId, REFUND_SCOPE, idempotencyKey, refundTransactionId, 201, now);
        PurchaseGraph current = requirePurchase(repository.find(member.getBookId(), purchaseId));
        RefundRow refund = current.refunds().stream()
                .filter(row -> row.refundId().equals(refundId))
                .findFirst().orElseThrow(this::refundNotFound);
        return refundResult(userId, current, refund);
    }

    @Transactional(readOnly = true)
    public CardPurchaseCorrectionPreview previewCorrection(
            UUID userId,
            UUID purchaseId,
            CorrectionCommand command
    ) {
        LedgerMemberEntity member = currentMember(userId);
        PurchaseGraph graph = requirePurchase(repository.find(member.getBookId(), purchaseId));
        requireVersion(graph, command.expectedVersion());
        CorrectionContext context = correctionContext(member.getBookId(), graph, command, false);
        CorrectionPlan plan = correctionPlan(graph, context);
        return new CardPurchaseCorrectionPreview(
                correctionPreviewToken(graph, command, context), graph.purchase().version(),
                plan.unpaidCardReductionWon(), accountReturnViews(plan.accountReturns()));
    }

    @Transactional
    public CardPurchaseManagementView correct(
            UUID userId,
            UUID purchaseId,
            String idempotencyKey,
            CorrectionApplyCommand command
    ) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMember(userId);
        Instant now = clock.instant();
        String requestHash = hash(purchaseId + "|" + command);
        TransactionIdempotencyRepository.Claim claim = idempotency.claim(
                userId, member.getBookId(), CORRECTION_SCOPE, idempotencyKey, requestHash, now);
        if (!claim.fresh()) {
            requireReplayRequest(claim, requestHash);
            if ("COMPLETED".equals(claim.status()) && claim.resourceId() != null) {
                PurchaseGraph current = requirePurchase(repository.find(member.getBookId(), purchaseId));
                return toManagement(userId, current);
            }
            throw idempotencyInProgress();
        }

        PurchaseGraph graph = requirePurchase(repository.findForUpdate(member.getBookId(), purchaseId));
        requireVersion(graph, command.expectedVersion());
        CorrectionContext context = correctionContext(
                member.getBookId(), graph, command.toPreviewCommand(), true);
        String currentToken = correctionPreviewToken(graph, command.toPreviewCommand(), context);
        requirePreviewToken(command.previewToken(), currentToken);
        CorrectionPlan plan = correctionPlan(graph, context);
        repository.correctPurchase(new CardPurchaseManagementRepository.CorrectionWrite(
                purchaseId, member.getBookId(), command.cardAssetId(), command.occurredOn(),
                command.amountWon(), command.categoryId(), command.performedByMemberId(),
                stripToNull(command.description()), command.excludedFromStatistics(),
                context.statementClosingDay(), context.paymentDay(),
                context.paymentMonthOffset(), command.expectedVersion(), member.getId(), now,
                context.absorbedByBalanceAnchor(),
                plan.installments(), plan.historicalRefundAllocations(), plan.paymentReductions(), graph));
        List<UUID> affectedCardAssetIds = new ArrayList<>();
        affectedCardAssetIds.add(graph.purchase().cardAssetId());
        affectedCardAssetIds.add(command.cardAssetId());
        for (UUID cardAssetId : affectedCardAssetIds.stream().distinct().toList()) {
            assetLedger.synchronizeCardPaymentSchedules(
                    member.getBookId(), cardAssetId,
                    cardSettings.findById(cardAssetId).orElse(null), now);
        }
        idempotency.complete(userId, CORRECTION_SCOPE, idempotencyKey, purchaseId, 200, now);
        return toManagement(userId, requirePurchase(repository.find(member.getBookId(), purchaseId)));
    }

    private RefundPlan refundPlan(
            PurchaseGraph graph, AnchorSettlement anchor, long requestedAmountWon
    ) {
        if (requestedAmountWon <= 0) {
            throw error(HttpStatus.BAD_REQUEST, "CARD_REFUND_AMOUNT_INVALID",
                    "환불 금액은 0원보다 커야 합니다.");
        }
        if (requestedAmountWon > graph.refundableAmountWon()) {
            throw error(HttpStatus.CONFLICT, "CARD_REFUND_AMOUNT_EXCEEDED",
                    "남은 환불 가능 금액을 초과할 수 없습니다.");
        }

        Map<UUID, Long> chargeRemaining = new LinkedHashMap<>();
        graph.charges().forEach(charge -> chargeRemaining.put(
                charge.chargeId(), charge.refundableAmountWon()));
        Map<UUID, Long> chargeAllocations = new LinkedHashMap<>();
        Map<UUID, Long> paymentAllocations = new LinkedHashMap<>();
        long remaining = requestedAmountWon;
        long unpaidAllocated = 0;

        List<StatementRow> latestStatements = graph.statements().stream()
                .sorted(Comparator.comparing(StatementRow::dueOn).reversed()
                        .thenComparing(StatementRow::statementId, Comparator.reverseOrder()))
                .toList();
        for (StatementRow statement : latestStatements) {
            if (remaining == 0) {
                break;
            }
            long amount = Math.min(remaining, statement.paymentAmountWon());
            long allocated = allocateCharges(
                    graph, statement.statementId(), amount, chargeRemaining, chargeAllocations);
            remaining -= allocated;
            unpaidAllocated += allocated;
        }

        List<PaymentRow> latestPayments = graph.payments().stream()
                .sorted(Comparator.comparing(PaymentRow::paidOn).reversed()
                        .thenComparing(PaymentRow::paymentId, Comparator.reverseOrder()))
                .toList();
        for (PaymentRow payment : latestPayments) {
            if (remaining == 0) {
                break;
            }
            long paymentAvailable = payment.effectiveAmountWon()
                    - paymentAllocations.getOrDefault(payment.paymentId(), 0L);
            if (paymentAvailable <= 0) {
                continue;
            }
            long allocated = allocateCharges(
                    graph, payment.statementId(), Math.min(remaining, paymentAvailable),
                    chargeRemaining, chargeAllocations);
            if (allocated > 0) {
                paymentAllocations.merge(payment.paymentId(), allocated, Long::sum);
                remaining -= allocated;
            }
        }
        if (remaining > 0) {
            long allocated = allocateAnchorAbsorbedCharges(
                    graph, remaining, chargeRemaining, chargeAllocations);
            remaining -= allocated;
            long unpaidAnchorReduction = Math.min(
                    allocated, anchor == null ? 0 : anchor.remainingAmountWon());
            unpaidAllocated += unpaidAnchorReduction;
            long paidAnchorReturn = allocated - unpaidAnchorReduction;
            if (paidAnchorReturn > 0 && anchor != null) {
                for (PaymentRow payment : anchor.payments()) {
                    if (paidAnchorReturn == 0) {
                        break;
                    }
                    long available = payment.effectiveAmountWon()
                            - paymentAllocations.getOrDefault(payment.paymentId(), 0L);
                    long returned = Math.min(paidAnchorReturn, Math.max(available, 0));
                    if (returned > 0) {
                        paymentAllocations.merge(payment.paymentId(), returned, Long::sum);
                        paidAnchorReturn -= returned;
                    }
                }
            }
            unpaidAllocated += paidAnchorReturn;
        }
        if (remaining != 0) {
            throw new IllegalStateException("refundable card purchase could not be allocated");
        }

        List<ChargeAllocation> chargeWrites = chargeAllocations.entrySet().stream()
                .map(entry -> new ChargeAllocation(entry.getKey(),
                        graph.charges().stream().filter(charge -> charge.chargeId().equals(entry.getKey()))
                                .findFirst().orElseThrow().statementId(), entry.getValue()))
                .toList();
        List<PaymentAllocation> paymentWrites = paymentAllocations.entrySet().stream()
                .map(entry -> new PaymentAllocation(entry.getKey(), entry.getValue())).toList();
        Map<UUID, PaymentRow> paymentRows = new LinkedHashMap<>();
        graph.payments().forEach(payment -> paymentRows.put(payment.paymentId(), payment));
        if (anchor != null) {
            anchor.payments().forEach(payment -> paymentRows.putIfAbsent(payment.paymentId(), payment));
        }
        Map<UUID, AccountAmount> accounts = new LinkedHashMap<>();
        for (PaymentAllocation allocation : paymentWrites) {
            PaymentRow payment = paymentRows.get(allocation.paymentId());
            if (payment == null) {
                throw new IllegalStateException("refund payment allocation is missing its payment");
            }
            AccountAmount prior = accounts.get(payment.settlementAssetId());
            accounts.put(payment.settlementAssetId(), new AccountAmount(
                    payment.settlementAssetId(), payment.settlementAssetName(),
                    (prior == null ? 0 : prior.amountWon()) + allocation.amountWon()));
        }
        return new RefundPlan(chargeWrites, paymentWrites, new ArrayList<>(accounts.values()),
                unpaidAllocated);
    }

    private long allocateCharges(
            PurchaseGraph graph,
            UUID statementId,
            long requested,
            Map<UUID, Long> remainingByCharge,
            Map<UUID, Long> allocations
    ) {
        long remaining = requested;
        List<ChargeRow> charges = graph.charges().stream()
                .filter(charge -> charge.statementId().equals(statementId))
                .filter(charge -> !charge.absorbedByBalanceAnchor())
                .sorted(Comparator.comparingInt(ChargeRow::installmentNo).reversed()
                        .thenComparing(ChargeRow::chargeId, Comparator.reverseOrder()))
                .toList();
        for (ChargeRow charge : charges) {
            if (remaining == 0) {
                break;
            }
            long available = remainingByCharge.getOrDefault(charge.chargeId(), 0L);
            long allocated = Math.min(remaining, available);
            if (allocated > 0) {
                allocations.merge(charge.chargeId(), allocated, Long::sum);
                remainingByCharge.put(charge.chargeId(), available - allocated);
                remaining -= allocated;
            }
        }
        return requested - remaining;
    }

    private long allocateAnchorAbsorbedCharges(
            PurchaseGraph graph,
            long requested,
            Map<UUID, Long> remainingByCharge,
            Map<UUID, Long> allocations
    ) {
        long remaining = requested;
        List<ChargeRow> charges = graph.charges().stream()
                .filter(ChargeRow::absorbedByBalanceAnchor)
                .sorted(Comparator.comparing(ChargeRow::expectedSettlementOn).reversed()
                        .thenComparingInt(ChargeRow::installmentNo).reversed()
                        .thenComparing(ChargeRow::chargeId, Comparator.reverseOrder()))
                .toList();
        for (ChargeRow charge : charges) {
            if (remaining == 0) {
                break;
            }
            long available = remainingByCharge.getOrDefault(charge.chargeId(), 0L);
            long allocated = Math.min(remaining, available);
            if (allocated > 0) {
                allocations.merge(charge.chargeId(), allocated, Long::sum);
                remainingByCharge.put(charge.chargeId(), available - allocated);
                remaining -= allocated;
            }
        }
        return requested - remaining;
    }

    private CorrectionContext correctionContext(
            UUID bookId,
            PurchaseGraph graph,
            CorrectionCommand command,
            boolean lockCategory
    ) {
        if (command.amountWon() <= 0 || command.installmentCount() < 1
                || command.installmentCount() > MAX_INSTALLMENTS
                || command.amountWon() < command.installmentCount()) {
            throw error(HttpStatus.BAD_REQUEST, "INSTALLMENT_INVALID",
                    "할부 개월 수와 금액을 확인해 주세요.");
        }
        long refundedAmountWon = graph.refunds().stream().mapToLong(RefundRow::amountWon).sum();
        if (command.amountWon() < refundedAmountWon) {
            throw error(HttpStatus.CONFLICT, "CARD_CORRECTION_BELOW_REFUNDED_AMOUNT",
                    "이미 환불한 누적 금액보다 구매 금액을 작게 정정할 수 없습니다.");
        }
        CategoryEntity category = (lockCategory
                ? categories.findActiveForRead(command.categoryId(), bookId)
                : categories.findByIdAndBookIdAndArchivedAtIsNull(command.categoryId(), bookId))
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "TRANSACTION_CATEGORY_INVALID",
                        "같은 가계부의 지출 분류를 선택해 주세요."));
        if (category.getKind() != CategoryKind.EXPENSE) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_CATEGORY_INVALID",
                    "같은 가계부의 지출 분류를 선택해 주세요.");
        }
        if (members.findByIdAndBookId(command.performedByMemberId(), bookId).isEmpty()) {
            throw error(HttpStatus.BAD_REQUEST, "TRANSACTION_PERFORMER_INVALID",
                    "같은 가계부의 구성원을 선택해 주세요.");
        }
        AssetEntity card = (lockCategory
                ? assets.findActiveForRead(command.cardAssetId(), bookId)
                : assets.findByIdAndBookIdAndArchivedAtIsNull(command.cardAssetId(), bookId))
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "TRANSACTION_ASSET_INVALID",
                        "같은 가계부의 활성 신용카드를 선택해 주세요."));
        AssetTypeEntity type = assetTypes.findByIdAndBookIdAndArchivedAtIsNull(
                        card.getAssetTypeId(), bookId)
                .orElseThrow(() -> new IllegalStateException("asset type is missing"));
        if (type.getBehavior() != AssetBehavior.CREDIT_CARD) {
            throw error(HttpStatus.BAD_REQUEST, "CARD_PURCHASE_CARD_REQUIRED",
                    "신용카드를 선택해 주세요.");
        }
        CardSettingEntity setting = cardSettings.findById(card.getId())
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "CARD_SETTINGS_MISSING",
                        "카드 설정을 먼저 입력해 주세요."));
        int closingDay = setting.getStatementClosingDay();
        int paymentDay = setting.getPaymentDay();
        int paymentOffset = setting.getPaymentMonthOffset();
        if (card.getId().equals(graph.purchase().cardAssetId())) {
            closingDay = graph.purchase().statementClosingDay();
            paymentDay = graph.purchase().paymentDay();
            paymentOffset = graph.purchase().paymentMonthOffset();
        }
        List<InstallmentTarget> installments = installments(
                command.occurredOn(), command.amountWon(), command.installmentCount(),
                closingDay, paymentDay, paymentOffset);
        return new CorrectionContext(card.getId(), closingDay, paymentDay, paymentOffset,
                command.occurredOn().isBefore(card.getOpenedOn()), installments);
    }

    private List<InstallmentTarget> installments(
            LocalDate occurredOn,
            long amountWon,
            int installmentCount,
            int closingDay,
            int paymentDay,
            int paymentMonthOffset
    ) {
        long base = amountWon / installmentCount;
        long remainder = amountWon % installmentCount;
        List<InstallmentTarget> installments = new ArrayList<>(installmentCount);
        for (int index = 0; index < installmentCount; index++) {
            CardBillingCyclePolicy.Cycle cycle = billingCyclePolicy.calculate(
                    occurredOn.plusMonths(index), closingDay, paymentDay,
                    paymentMonthOffset, assetLedger::isPublicHoliday);
            installments.add(new InstallmentTarget(
                    index + 1, base + (index < remainder ? 1 : 0),
                    cycle.start(), cycle.end(), cycle.dueOn(), new ChargeIdHolder()));
        }
        return installments;
    }

    private CorrectionPlan correctionPlan(PurchaseGraph graph, CorrectionContext context) {
        List<InstallmentTarget> targets = context.installments();
        Map<InstallmentTarget, Long> targetRemaining = new LinkedHashMap<>();
        targets.forEach(target -> targetRemaining.put(target, target.amountWon()));
        List<HistoricalRefundTarget> historicalAllocations = new ArrayList<>();
        List<InstallmentTarget> latestTargets = targets.stream()
                .sorted(Comparator.comparing(InstallmentTarget::dueOn).reversed()
                        .thenComparing(InstallmentTarget::number, Comparator.reverseOrder()))
                .toList();
        for (RefundRow refund : graph.refunds()) {
            long remaining = refund.amountWon();
            for (InstallmentTarget target : latestTargets) {
                if (remaining == 0) {
                    break;
                }
                long available = targetRemaining.get(target);
                long amount = Math.min(remaining, available);
                if (amount > 0) {
                    historicalAllocations.add(new HistoricalRefundTarget(
                            refund.refundId(), target.chargeIdHolder(), amount));
                    targetRemaining.put(target, available - amount);
                    remaining -= amount;
                }
            }
            if (remaining != 0) {
                throw new IllegalStateException("historical refund exceeds corrected purchase");
            }
        }

        Map<StatementKey, Long> targetEffective = new HashMap<>();
        if (!context.absorbedByBalanceAnchor()) {
            targets.forEach(target -> targetEffective.merge(
                    new StatementKey(target.cycleStart(), target.cycleEnd(), target.dueOn()),
                    targetRemaining.get(target), Long::sum));
        }
        Map<UUID, Long> oldEffective = new HashMap<>();
        graph.charges().stream()
                .filter(charge -> !charge.absorbedByBalanceAnchor())
                .forEach(charge -> oldEffective.merge(
                        charge.statementId(), charge.refundableAmountWon(), Long::sum));
        Map<UUID, List<PaymentRow>> paymentsByStatement = new HashMap<>();
        graph.payments().forEach(payment -> paymentsByStatement
                .computeIfAbsent(payment.statementId(), ignored -> new ArrayList<>()).add(payment));
        List<PaymentReduction> reductions = new ArrayList<>();
        Map<UUID, AccountAmount> accounts = new LinkedHashMap<>();
        for (StatementRow statement : graph.statements()) {
            StatementKey key = new StatementKey(
                    statement.cycleStart(), statement.cycleEnd(), statement.dueOn());
            long targetContribution = statement.cardAssetId().equals(context.cardAssetId())
                    ? targetEffective.getOrDefault(key, 0L) : 0;
            long newGross = Math.max(0,
                    statement.grossAmountWon()
                            - oldEffective.getOrDefault(statement.statementId(), 0L)
                            + targetContribution);
            long excess = Math.max(0, statement.paidAmountWon() - newGross);
            List<PaymentRow> payments = paymentsByStatement.getOrDefault(
                            statement.statementId(), List.of()).stream()
                    .sorted(Comparator.comparing(PaymentRow::paidOn).reversed()
                            .thenComparing(PaymentRow::paymentId, Comparator.reverseOrder()))
                    .toList();
            for (PaymentRow payment : payments) {
                if (excess == 0) {
                    break;
                }
                long reduction = Math.min(excess, payment.effectiveAmountWon());
                if (reduction == 0) {
                    continue;
                }
                reductions.add(new PaymentReduction(
                        payment.paymentId(), payment.statementId(), payment.settlementTransactionId(),
                        graph.purchase().bookId(), payment.settlementAssetId(),
                        statement.cardAssetId(), payment.amountWon() - reduction));
                AccountAmount previous = accounts.get(payment.settlementAssetId());
                accounts.put(payment.settlementAssetId(), new AccountAmount(
                        payment.settlementAssetId(), payment.settlementAssetName(),
                        (previous == null ? 0 : previous.amountWon()) + reduction));
                excess -= reduction;
            }
        }
        long oldEffectiveAmount = graph.charges().stream()
                .filter(charge -> !charge.absorbedByBalanceAnchor())
                .mapToLong(ChargeRow::refundableAmountWon).sum();
        long newEffectiveAmount = context.absorbedByBalanceAnchor() ? 0
                : targetRemaining.values().stream().mapToLong(Long::longValue).sum();
        long accountReturnAmount = accounts.values().stream().mapToLong(AccountAmount::amountWon).sum();
        long unpaidReduction = Math.max(0,
                oldEffectiveAmount - newEffectiveAmount - accountReturnAmount);
        return new CorrectionPlan(targets, historicalAllocations, reductions,
                new ArrayList<>(accounts.values()), unpaidReduction);
    }

    private CardPurchaseManagementView toManagement(UUID userId, PurchaseGraph graph) {
        Map<UUID, List<CardPaymentView>> payments = new HashMap<>();
        for (PaymentRow payment : graph.payments()) {
            payments.computeIfAbsent(payment.statementId(), ignored -> new ArrayList<>())
                    .add(new CardPaymentView(
                            payment.paymentId(), payment.paymentType(), payment.settlementAssetId(),
                            payment.settlementAssetName(), payment.amountWon(),
                            payment.returnedAmountWon(), payment.effectiveAmountWon(), payment.paidOn(),
                            payment.settlementTransactionId(), payment.createdByMemberId()));
        }
        Map<UUID, List<AccountReturnView>> refundAccounts = new HashMap<>();
        graph.refundAccounts().forEach(account -> refundAccounts
                .computeIfAbsent(account.refundId(), ignored -> new ArrayList<>())
                .add(new AccountReturnView(account.assetId(), account.assetName(), account.amountWon())));
        return new CardPurchaseManagementView(
                transactionService.transaction(userId, graph.purchase().transactionId()),
                new BillingSnapshotView(
                        graph.purchase().cardAssetId(), graph.purchase().cardAssetName(),
                        graph.purchase().statementClosingDay(), graph.purchase().paymentDay(),
                        graph.purchase().paymentMonthOffset(), graph.purchase().installmentCount()),
                graph.refundableAmountWon(),
                graph.charges().stream().map(charge -> new CardChargeView(
                        charge.chargeId(), charge.statementId(), charge.installmentNo(),
                        charge.installmentCount(), charge.principalAmountWon(),
                        charge.refundedAmountWon(), charge.refundableAmountWon(),
                        charge.expectedSettlementOn())).toList(),
                graph.statements().stream().map(statement -> new CardStatementView(
                        statement.statementId(), statement.dueOn(), statement.status(),
                        statement.grossAmountWon(), statement.paidAmountWon(),
                        statement.paymentAmountWon(), statement.version(),
                        payments.getOrDefault(statement.statementId(), List.of()))).toList(),
                graph.refunds().stream().map(refund -> new CardRefundView(
                        refund.refundId(), refund.refundTransactionId(), refund.refundedOn(),
                        refund.amountWon(), refund.excludedFromStatistics(), refund.unpaidCardReductionWon(),
                        refundAccounts.getOrDefault(refund.refundId(), List.of()))).toList());
    }

    private CardPurchaseRefundResult refundResult(UUID userId, PurchaseGraph graph, RefundRow refund) {
        List<AccountReturnView> accounts = graph.refundAccounts().stream()
                .filter(row -> row.refundId().equals(refund.refundId()))
                .map(row -> new AccountReturnView(row.assetId(), row.assetName(), row.amountWon()))
                .toList();
        return new CardPurchaseRefundResult(
                transactionService.transaction(userId, graph.purchase().transactionId()),
                transactionService.transaction(userId, refund.refundTransactionId()),
                refund.unpaidCardReductionWon(), accounts);
    }

    private List<AccountReturnView> accountReturnViews(List<AccountAmount> accounts) {
        return accounts.stream().map(account -> new AccountReturnView(
                account.assetId(), account.assetName(), account.amountWon())).toList();
    }

    private String refundPreviewToken(
            PurchaseGraph graph, AnchorSettlement anchor, RefundCommand command
    ) {
        return hash(graph.concurrencyState() + "|anchor|"
                + (anchor == null ? "none" : anchor.concurrencyState())
                + "|refund|" + command);
    }

    private String correctionPreviewToken(
            PurchaseGraph graph,
            CorrectionCommand command,
            CorrectionContext context
    ) {
        return hash(graph.concurrencyState() + "|correction|" + command
                + '|' + context.statementClosingDay() + '|' + context.paymentDay()
                + '|' + context.paymentMonthOffset()
                + '|' + context.absorbedByBalanceAnchor());
    }

    private PurchaseGraph requirePurchase(PurchaseGraph graph) {
        if (graph == null) {
            throw error(HttpStatus.NOT_FOUND, "CARD_PURCHASE_NOT_FOUND",
                    "카드 구매를 찾을 수 없습니다.");
        }
        if (graph.purchase().type() != TransactionType.EXPENSE
                || !"MANUAL".equals(graph.purchase().sourceType())) {
            throw error(HttpStatus.CONFLICT, "CARD_PURCHASE_REQUIRED",
                    "기록 정정 또는 환불 처리가 가능한 카드 구매가 아닙니다.");
        }
        return graph;
    }

    private void requireVersion(PurchaseGraph graph, long expectedVersion) {
        if (graph.purchase().version() != expectedVersion) {
            throw error(HttpStatus.PRECONDITION_FAILED, "VERSION_CONFLICT",
                    "편집하는 동안 카드 구매가 변경되었습니다.");
        }
    }

    private void requirePreviewToken(String submitted, String current) {
        if (submitted == null || !MessageDigest.isEqual(
                submitted.getBytes(StandardCharsets.UTF_8), current.getBytes(StandardCharsets.UTF_8))) {
            throw error(HttpStatus.PRECONDITION_FAILED, "CARD_PURCHASE_PREVIEW_STALE",
                    "미리보기 이후 카드 명세 또는 결제 내역이 변경되었습니다.");
        }
    }

    private void requireReplayRequest(TransactionIdempotencyRepository.Claim claim, String requestHash) {
        if (!requestHash.equals(claim.requestHash())) {
            throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                    "같은 중복 방지 키를 다른 요청에 사용할 수 없습니다.");
        }
    }

    private LedgerMemberEntity currentMember(UUID userId) {
        return members.findByUserId(userId).orElseThrow(() -> error(
                HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다."));
    }

    private ApiException idempotencyInProgress() {
        return error(HttpStatus.CONFLICT, "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                "동일한 요청이 처리 중입니다.");
    }

    private ApiException refundNotFound() {
        return error(HttpStatus.NOT_FOUND, "CARD_REFUND_NOT_FOUND", "환불 기록을 찾을 수 없습니다.");
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

    public record RefundCommand(
            LocalDate refundedOn,
            long amountWon,
            long expectedVersion,
            String description,
            boolean excludedFromStatistics
    ) {
        public RefundCommand(LocalDate refundedOn, long amountWon, long expectedVersion, String description) {
            this(refundedOn, amountWon, expectedVersion, description, false);
        }
    }

    public record RefundApplyCommand(
            LocalDate refundedOn,
            long amountWon,
            long expectedVersion,
            String description,
            String previewToken,
            boolean excludedFromStatistics
    ) {
        public RefundApplyCommand(
                LocalDate refundedOn, long amountWon, long expectedVersion,
                String description, String previewToken
        ) {
            this(refundedOn, amountWon, expectedVersion, description, previewToken, false);
        }

        public RefundCommand toPreviewCommand() {
            return new RefundCommand(
                    refundedOn, amountWon, expectedVersion, description, excludedFromStatistics);
        }
    }

    public record CorrectionCommand(
            LocalDate occurredOn,
            long amountWon,
            UUID categoryId,
            UUID cardAssetId,
            UUID performedByMemberId,
            String description,
            int installmentCount,
            long expectedVersion,
            boolean excludedFromStatistics
    ) {
        public CorrectionCommand(
                LocalDate occurredOn, long amountWon, UUID categoryId, UUID cardAssetId,
                UUID performedByMemberId, String description, int installmentCount,
                long expectedVersion
        ) {
            this(occurredOn, amountWon, categoryId, cardAssetId, performedByMemberId,
                    description, installmentCount, expectedVersion, false);
        }
    }

    public record CorrectionApplyCommand(
            LocalDate occurredOn,
            long amountWon,
            UUID categoryId,
            UUID cardAssetId,
            UUID performedByMemberId,
            String description,
            int installmentCount,
            long expectedVersion,
            String previewToken,
            boolean excludedFromStatistics
    ) {
        public CorrectionApplyCommand(
                LocalDate occurredOn, long amountWon, UUID categoryId, UUID cardAssetId,
                UUID performedByMemberId, String description, int installmentCount,
                long expectedVersion, String previewToken
        ) {
            this(occurredOn, amountWon, categoryId, cardAssetId, performedByMemberId,
                    description, installmentCount, expectedVersion, previewToken, false);
        }

        public CorrectionCommand toPreviewCommand() {
            return new CorrectionCommand(
                    occurredOn, amountWon, categoryId, cardAssetId, performedByMemberId,
                    description, installmentCount, expectedVersion, excludedFromStatistics);
        }
    }

    public record AccountReturnView(UUID assetId, String assetName, long amountWon) {
    }

    public record BillingSnapshotView(
            UUID cardAssetId,
            String cardAssetName,
            int statementClosingDay,
            int paymentDay,
            int paymentMonthOffset,
            int installmentCount
    ) {
    }

    public record CardChargeView(
            UUID chargeId,
            UUID statementId,
            int installmentNo,
            int installmentCount,
            long principalAmountWon,
            long refundedAmountWon,
            long refundableAmountWon,
            LocalDate expectedSettlementOn
    ) {
    }

    public record CardPaymentView(
            UUID paymentId,
            String paymentType,
            UUID settlementAssetId,
            String settlementAssetName,
            long amountWon,
            long returnedAmountWon,
            long effectiveAmountWon,
            LocalDate paidOn,
            UUID settlementTransactionId,
            UUID createdByMemberId
    ) {
    }

    public record CardStatementView(
            UUID statementId,
            LocalDate dueOn,
            String status,
            long grossAmountWon,
            long paidAmountWon,
            long paymentAmountWon,
            long version,
            List<CardPaymentView> payments
    ) {
    }

    public record CardRefundView(
            UUID refundId,
            UUID refundTransactionId,
            LocalDate refundedOn,
            long amountWon,
            boolean excludedFromStatistics,
            long unpaidCardReductionWon,
            List<AccountReturnView> accountReturns
    ) {
    }

    public record CardPurchaseManagementView(
            TransactionService.TransactionView purchase,
            BillingSnapshotView billingSnapshot,
            long refundableAmountWon,
            List<CardChargeView> charges,
            List<CardStatementView> statements,
            List<CardRefundView> refunds
    ) {
    }

    public record CardPurchaseRefundPreview(
            String previewToken,
            long purchaseVersion,
            long refundableAmountWon,
            long unpaidCardReductionWon,
            List<AccountReturnView> accountReturns
    ) {
    }

    public record CardPurchaseCorrectionPreview(
            String previewToken,
            long purchaseVersion,
            long unpaidCardReductionWon,
            List<AccountReturnView> accountReturns
    ) {
    }

    public record CardPurchaseRefundResult(
            TransactionService.TransactionView purchase,
            TransactionService.TransactionView refundTransaction,
            long unpaidCardReductionWon,
            List<AccountReturnView> accountReturns
    ) {
    }

    private record RefundPlan(
            List<ChargeAllocation> chargeAllocations,
            List<PaymentAllocation> paymentAllocations,
            List<AccountAmount> accountReturns,
            long unpaidCardReductionWon
    ) {
    }

    private record CorrectionContext(
            UUID cardAssetId,
            int statementClosingDay,
            int paymentDay,
            int paymentMonthOffset,
            boolean absorbedByBalanceAnchor,
            List<InstallmentTarget> installments
    ) {
    }

    private record CorrectionPlan(
            List<InstallmentTarget> installments,
            List<HistoricalRefundTarget> historicalRefundAllocations,
            List<PaymentReduction> paymentReductions,
            List<AccountAmount> accountReturns,
            long unpaidCardReductionWon
    ) {
    }

    private record StatementKey(LocalDate start, LocalDate end, LocalDate dueOn) {
    }
}
