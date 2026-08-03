package com.dondok.settlement.application;

import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository;
import com.dondok.settlement.domain.CardStatementPaymentPolicy;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository.PaymentRow;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository.StatementCursor;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository.StatementRow;
import com.dondok.settlement.infrastructure.persistence.SettlementIdempotencyRepository;
import com.dondok.transaction.application.ManagedTransferPort;
import com.dondok.transaction.domain.TransactionType;
import com.dondok.transaction.domain.TransferSubtype;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CardStatementService {
    private static final String PREPAYMENT_SCOPE = "POST:/api/card-statements/prepayments";
    private static final ZoneId SERVICE_ZONE = ZoneId.of("Asia/Seoul");
    private static final int MAX_PAGE_SIZE = 50;

    private final CardSettlementRepository repository;
    private final SettlementIdempotencyRepository idempotency;
    private final ManagedTransferPort managedTransfers;
    private final LedgerMemberRepository members;
    private final LedgerMutationGuard mutationGuard;
    private final CardStatementPaymentPolicy paymentPolicy;
    private final Clock clock;

    public CardStatementService(
            CardSettlementRepository repository,
            SettlementIdempotencyRepository idempotency,
            ManagedTransferPort managedTransfers,
            LedgerMemberRepository members,
            LedgerMutationGuard mutationGuard,
            CardStatementPaymentPolicy paymentPolicy,
            Clock clock
    ) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.managedTransfers = managedTransfers;
        this.members = members;
        this.mutationGuard = mutationGuard;
        this.paymentPolicy = paymentPolicy;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CardStatementPage statements(
            UUID userId,
            UUID cardAssetId,
            String encodedCursor,
            int limit,
            boolean includePaid
    ) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw error(HttpStatus.BAD_REQUEST, "CARD_STATEMENT_PAGE_INVALID",
                    "페이지 크기를 확인해 주세요.");
        }
        LedgerMemberEntity member = currentMember(userId);
        CardSettlementRepository.CardAssetRow card = repository.findCardAsset(
                member.getBookId(), cardAssetId);
        if (card == null) {
            throw error(HttpStatus.NOT_FOUND, "ASSET_NOT_FOUND", "자산을 찾을 수 없습니다.");
        }
        if (!"CREDIT_CARD".equals(card.behavior())) {
            throw error(HttpStatus.CONFLICT, "ASSET_NOT_CREDIT_CARD", "신용카드 자산만 조회할 수 있습니다.");
        }
        StatementCursor cursor = decodeCursor(encodedCursor);
        List<StatementRow> rows = repository.statementPage(
                member.getBookId(), cardAssetId, cursor, limit + 1, includePaid);
        boolean hasNext = rows.size() > limit;
        List<StatementRow> selected = hasNext ? rows.subList(0, limit) : rows;
        String nextCursor = hasNext && !selected.isEmpty()
                ? encodeCursor(selected.get(selected.size() - 1)) : null;
        return new CardStatementPage(selected.stream().map(this::summary).toList(), nextCursor);
    }

    @Transactional(readOnly = true)
    public CardStatementDetail statement(UUID userId, UUID statementId) {
        LedgerMemberEntity member = currentMember(userId);
        return detail(requiredStatement(member.getBookId(), statementId));
    }

    @Transactional(readOnly = true)
    public CardStatementPrepaymentPreview preview(
            UUID userId,
            UUID statementId,
            PrepaymentCommand command
    ) {
        LedgerMemberEntity member = currentMember(userId);
        StatementRow statement = requiredStatement(member.getBookId(), statementId);
        if (statement.version() != command.expectedVersion()) {
            throw versionConflict(statement);
        }
        LocalDate today = today();
        requirePrepayable(statement, command.amountWon(), today);
        CardStatementPaymentPolicy.PrepaymentDecision decision = prepaymentDecision(
                statement.remainingAmountWon(), command.amountWon());
        long afterBalance = subtract(statement.settlementAssetBalanceWon(), command.amountWon());
        return new CardStatementPrepaymentPreview(
                previewToken(statement, command.amountWon(), today), statement.version(),
                command.amountWon(), today, statement.remainingAmountWon(),
                decision.afterRemainingAmountWon(),
                settlementAsset(statement), afterBalance);
    }

    @Transactional
    public CardStatementPaymentResult prepay(
            UUID userId,
            UUID statementId,
            String idempotencyKey,
            PrepaymentApplyCommand command
    ) {
        LedgerMemberEntity member = mutationGuard.lockCurrentMember(userId);
        Instant now = clock.instant();
        String requestHash = hash(statementId + "|" + command);
        SettlementIdempotencyRepository.Claim claim = idempotency.claim(
                userId, member.getBookId(), PREPAYMENT_SCOPE, idempotencyKey, requestHash, now);
        if (!claim.fresh()) {
            if (!requestHash.equals(claim.requestHash())) {
                throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                        "같은 중복 방지 키를 다른 요청에 사용할 수 없습니다.");
            }
            if ("COMPLETED".equals(claim.status()) && claim.resourceId() != null) {
                return replay(member.getBookId(), claim.resourceId());
            }
            throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                    "동일한 선결제 요청이 처리 중입니다.");
        }

        StatementRow statement = repository.lockStatement(member.getBookId(), statementId);
        if (statement == null) {
            throw statementNotFound();
        }
        LocalDate today = today();
        if (statement.version() != command.expectedVersion()
                || !MessageDigest.isEqual(
                previewToken(statement, command.amountWon(), today).getBytes(StandardCharsets.UTF_8),
                command.previewToken().getBytes(StandardCharsets.UTF_8))) {
            throw previewStale(statement);
        }
        requirePrepayable(statement, command.amountWon(), today);
        CardStatementPaymentPolicy.PrepaymentDecision decision = prepaymentDecision(
                statement.remainingAmountWon(), command.amountWon());

        UUID paymentId = UuidV7.next();
        UUID transactionId = UuidV7.next();
        ManagedTransferPort.ManagedTransfer transfer = managedTransfers.create(
                new ManagedTransferPort.CreateCommand(
                        transactionId, member.getBookId(), TransferSubtype.CARD_PREPAYMENT,
                        today, command.amountWon(), "카드 선결제", "CARD_PREPAYMENT",
                        paymentId, member.getId(), now,
                        List.of(
                                new ManagedTransferPort.Posting(
                                        statement.settlementAssetId(), -command.amountWon()),
                                new ManagedTransferPort.Posting(
                                        statement.cardAssetId(), command.amountWon()))));
        repository.insertPayment(new CardSettlementRepository.PaymentWrite(
                paymentId, member.getBookId(), statementId, "PREPAYMENT",
                statement.settlementAssetId(), command.amountWon(), today,
                transactionId, member.getId(), now));
        repository.recordPrepayment(
                statementId, decision.fullyPaid(), now);
        idempotency.complete(userId, PREPAYMENT_SCOPE, idempotencyKey, paymentId, now);

        StatementRow current = requiredStatement(member.getBookId(), statementId);
        PaymentRow payment = requiredPayment(member.getBookId(), paymentId);
        return new CardStatementPaymentResult(
                detail(current), payment(payment), transaction(transfer));
    }

    private CardStatementPaymentResult replay(UUID bookId, UUID paymentId) {
        PaymentRow payment = requiredPayment(bookId, paymentId);
        ManagedTransferPort.ManagedTransfer transfer = managedTransfers.find(
                bookId, payment.settlementTransactionId());
        if (transfer == null) {
            throw new IllegalStateException("idempotent prepayment transfer is missing");
        }
        return new CardStatementPaymentResult(
                detail(requiredStatement(bookId, payment.statementId())),
                payment(payment), transaction(transfer));
    }

    private CardStatementDetail detail(StatementRow row) {
        CardStatementSummary summary = summary(row);
        long prepayable = isPrepayable(row, today()) ? row.remainingAmountWon() : 0;
        return new CardStatementDetail(
                summary.statementId(), summary.cardAsset(), summary.dueOn(), summary.status(),
                summary.grossAmountWon(), summary.paidAmountWon(), summary.remainingAmountWon(),
                summary.version(), summary.automaticSettlement(), prepayable,
                row.settlementAssetId() == null ? null : settlementAsset(row),
                row.autoSettlementEnabled(),
                repository.payments(row.bookId(), row.statementId()).stream()
                        .map(this::payment).toList());
    }

    private CardStatementSummary summary(StatementRow row) {
        AutomaticSettlement automaticSettlement = row.scheduleId() == null ? null
                : new AutomaticSettlement(
                        row.scheduleId(), row.scheduledOn(), row.scheduleStatus(),
                        row.attemptCount(), row.nextRetryAt());
        return new CardStatementSummary(
                row.statementId(), new AssetReference(row.cardAssetId(), row.cardAssetName()),
                row.dueOn(), row.status(), row.grossAmountWon(), row.paidAmountWon(),
                row.remainingAmountWon(), row.version(), automaticSettlement);
    }

    private CardStatementPayment payment(PaymentRow payment) {
        return new CardStatementPayment(
                payment.paymentId(), payment.paymentType(), payment.settlementAssetId(),
                payment.settlementAssetName(), payment.amountWon(), payment.returnedAmountWon(),
                Math.max(payment.amountWon() - payment.returnedAmountWon(), 0), payment.paidOn(),
                payment.settlementTransactionId(), payment.createdByMemberId());
    }

    private SettlementAsset settlementAsset(StatementRow statement) {
        if (statement.settlementAssetId() == null) {
            throw error(HttpStatus.CONFLICT, "CARD_SETTLEMENT_ASSET_REQUIRED",
                    "카드의 결제 계좌를 먼저 설정해 주세요.");
        }
        return new SettlementAsset(
                statement.settlementAssetId(), statement.settlementAssetName(),
                statement.settlementAssetBalanceWon());
    }

    private SettlementTransaction transaction(ManagedTransferPort.ManagedTransfer transfer) {
        TransactionMember creator = transfer.createdBy() == null ? null
                : new TransactionMember(
                        transfer.createdBy().memberId(), transfer.createdBy().displayName());
        return new SettlementTransaction(
                transfer.transactionId(), TransactionType.TRANSFER, transfer.transferSubtype(),
                "SYSTEM", null, transfer.occurredOn(), transfer.amountWon(), null,
                null, creator, null, transfer.description(),
                transfer.postings().stream().map(posting -> new TransactionPosting(
                        posting.assetId(), posting.assetName(), posting.deltaWon())).toList(),
                null, transfer.version(), transfer.createdAt(), transfer.updatedAt());
    }

    private void requirePrepayable(StatementRow statement, long amountWon, LocalDate today) {
        if (!List.of("OPEN", "FINALIZED").contains(statement.status())
                || statement.remainingAmountWon() == 0) {
            throw error(HttpStatus.CONFLICT, "CARD_STATEMENT_NOT_PAYABLE",
                    "현재 결제할 카드 명세가 아닙니다.");
        }
        if (!today.isBefore(statement.dueOn())) {
            throw error(HttpStatus.CONFLICT, "CARD_PREPAYMENT_DUE_DATE_REACHED",
                    "결제일 전까지만 선결제를 기록할 수 있습니다.");
        }
        settlementAsset(statement);
        prepaymentDecision(statement.remainingAmountWon(), amountWon);
    }

    private CardStatementPaymentPolicy.PrepaymentDecision prepaymentDecision(
            long remainingAmountWon,
            long amountWon
    ) {
        try {
            return paymentPolicy.prepayment(remainingAmountWon, amountWon);
        } catch (CardStatementPaymentPolicy.PaymentAmountException exception) {
            if (exception.error() == CardStatementPaymentPolicy.PaymentAmountError.NON_POSITIVE) {
                throw error(HttpStatus.BAD_REQUEST, "CARD_PREPAYMENT_AMOUNT_INVALID",
                        "선결제 금액은 0원보다 커야 합니다.");
            }
            throw error(HttpStatus.CONFLICT, "CARD_PREPAYMENT_AMOUNT_EXCEEDED",
                    "남은 카드 결제 금액을 초과할 수 없습니다.");
        }
    }

    private boolean isPrepayable(StatementRow statement, LocalDate today) {
        return List.of("OPEN", "FINALIZED").contains(statement.status())
                && statement.remainingAmountWon() > 0
                && today.isBefore(statement.dueOn())
                && statement.settlementAssetId() != null;
    }

    private StatementRow requiredStatement(UUID bookId, UUID statementId) {
        StatementRow statement = repository.findStatement(bookId, statementId);
        if (statement == null) {
            throw statementNotFound();
        }
        return statement;
    }

    private PaymentRow requiredPayment(UUID bookId, UUID paymentId) {
        PaymentRow payment = repository.findPayment(bookId, paymentId);
        if (payment == null) {
            throw new IllegalStateException("card statement payment is missing");
        }
        return payment;
    }

    private LedgerMemberEntity currentMember(UUID userId) {
        return members.findByUserId(userId).orElseThrow(() -> error(
                HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다."));
    }

    private String previewToken(StatementRow statement, long amountWon, LocalDate appliedOn) {
        return hash(statement.statementId() + "|" + statement.version() + "|"
                + statement.status() + "|" + statement.remainingAmountWon() + "|"
                + amountWon + "|" + appliedOn + "|" + statement.settlementAssetId());
    }

    private ApiException versionConflict(StatementRow statement) {
        return new ApiException(
                HttpStatus.PRECONDITION_FAILED, "VERSION_CONFLICT",
                "편집하는 동안 카드 명세가 변경되었습니다.",
                Map.of("latestStatement", detail(statement)));
    }

    private ApiException previewStale(StatementRow statement) {
        return new ApiException(
                HttpStatus.PRECONDITION_FAILED, "CARD_STATEMENT_PREVIEW_STALE",
                "미리보기 후 카드 명세나 결제 계좌가 변경되었습니다.",
                Map.of("latestStatement", detail(statement)));
    }

    private ApiException statementNotFound() {
        return error(HttpStatus.NOT_FOUND, "CARD_STATEMENT_NOT_FOUND", "카드 명세를 찾을 수 없습니다.");
    }

    private StatementCursor decodeCursor(String encoded) {
        if (encoded == null || encoded.isBlank()) {
            return null;
        }
        try {
            String[] parts = new String(
                    Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8).split("\\|", 2);
            return new StatementCursor(LocalDate.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (RuntimeException exception) {
            throw error(HttpStatus.BAD_REQUEST, "CARD_STATEMENT_CURSOR_INVALID",
                    "목록 커서가 올바르지 않습니다.");
        }
    }

    private String encodeCursor(StatementRow row) {
        String raw = row.dueOn() + "|" + row.statementId();
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private LocalDate today() {
        return clock.instant().atZone(SERVICE_ZONE).toLocalDate();
    }

    private long subtract(long value, long amount) {
        try {
            return Math.subtractExact(value, amount);
        } catch (ArithmeticException exception) {
            throw error(HttpStatus.BAD_REQUEST, "AMOUNT_RANGE_INVALID", "금액 범위를 확인해 주세요.");
        }
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private ApiException error(HttpStatus status, String code, String message) {
        return new ApiException(status, code, message);
    }

    public record PrepaymentCommand(long amountWon, long expectedVersion) {
    }

    public record PrepaymentApplyCommand(long amountWon, long expectedVersion, String previewToken) {
    }

    public record AssetReference(UUID assetId, String name) {
    }

    public record SettlementAsset(UUID assetId, String name, long currentBalanceWon) {
    }

    public record AutomaticSettlement(
            UUID scheduleId,
            LocalDate scheduledOn,
            String status,
            int attemptCount,
            Instant nextRetryAt
    ) {
    }

    public record CardStatementSummary(
            UUID statementId,
            AssetReference cardAsset,
            LocalDate dueOn,
            String status,
            long grossAmountWon,
            long paidAmountWon,
            long remainingAmountWon,
            long version,
            AutomaticSettlement automaticSettlement
    ) {
    }

    public record CardStatementDetail(
            UUID statementId,
            AssetReference cardAsset,
            LocalDate dueOn,
            String status,
            long grossAmountWon,
            long paidAmountWon,
            long remainingAmountWon,
            long version,
            AutomaticSettlement automaticSettlement,
            long prepayableAmountWon,
            SettlementAsset settlementAsset,
            boolean autoSettlementEnabled,
            List<CardStatementPayment> payments
    ) {
    }

    public record CardStatementPage(List<CardStatementSummary> items, String nextCursor) {
    }

    public record CardStatementPayment(
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

    public record CardStatementPrepaymentPreview(
            String previewToken,
            long statementVersion,
            long amountWon,
            LocalDate appliedOn,
            long currentRemainingAmountWon,
            long afterRemainingAmountWon,
            SettlementAsset settlementAsset,
            long afterSettlementAssetBalanceWon
    ) {
    }

    public record TransactionMember(UUID memberId, String displayName) {
    }

    public record TransactionPosting(UUID assetId, String assetName, long deltaWon) {
    }

    public record SettlementTransaction(
            UUID transactionId,
            TransactionType type,
            TransferSubtype transferSubtype,
            String managementType,
            UUID relatedPurchaseTransactionId,
            LocalDate occurredOn,
            long amountWon,
            Object category,
            TransactionMember performedBy,
            TransactionMember createdBy,
            AssetReference asset,
            String description,
            List<TransactionPosting> postings,
            Integer installmentCount,
            long version,
            Instant createdAt,
            Instant updatedAt
    ) {
    }

    public record CardStatementPaymentResult(
            CardStatementDetail statement,
            CardStatementPayment payment,
            SettlementTransaction settlementTransaction
    ) {
    }
}
