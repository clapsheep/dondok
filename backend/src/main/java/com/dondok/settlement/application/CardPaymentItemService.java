package com.dondok.settlement.application;

import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.membership.application.LedgerMutationGuard;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import com.dondok.settlement.infrastructure.persistence.CardPaymentItemRepository;
import com.dondok.settlement.infrastructure.persistence.CardPaymentItemRepository.*;
import com.dondok.settlement.infrastructure.persistence.CardSettlementRepository;
import com.dondok.settlement.infrastructure.persistence.SettlementIdempotencyRepository;
import com.dondok.transaction.application.ManagedTransferPort;
import com.dondok.transaction.domain.TransferSubtype;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CardPaymentItemService {
    private static final String SCOPE = "POST:/api/assets/card-payments";
    private final CardPaymentItemRepository items;
    private final CardSettlementRepository settlements;
    private final SettlementIdempotencyRepository idempotency;
    private final LedgerMemberRepository members;
    private final LedgerMutationGuard guard;
    private final ManagedTransferPort transfers;
    private final Clock clock;
    public CardPaymentItemService(CardPaymentItemRepository items, CardSettlementRepository settlements,
            SettlementIdempotencyRepository idempotency, LedgerMemberRepository members,
            LedgerMutationGuard guard, ManagedTransferPort transfers, Clock clock) {
        this.items = items; this.settlements = settlements; this.idempotency = idempotency;
        this.members = members; this.guard = guard; this.transfers = transfers; this.clock = clock;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page list(UUID user, UUID cardId, String cursor, int limit) {
        if (limit < 1 || limit > 50) throw error(400, "CARD_PAYMENT_PAGE_INVALID", "조회 개수를 확인해 주세요.");
        var member = members.findByUserId(user).orElseThrow(() -> error(404, "LEDGER_NOT_FOUND", "가계부를 찾을 수 없습니다."));
        Card card = requireCard(member.getBookId(), cardId);
        LocalDate closing = latestClosing(today(), card.closingDay());
        var rows = items.items(member.getBookId(), cardId, closing, decode(cursor), limit + 1, null, List.of(), List.of());
        var selected = rows.size() > limit ? rows.subList(0, limit) : rows;
        return new Page(selected, rows.size() > limit ? encode(selected.get(selected.size() - 1)) : null,
                closing, card.token() + ":" + closing, items.totals(member.getBookId(), cardId, closing));
    }

    @Transactional
    public Result pay(UUID user, UUID cardId, String key, Command command) {
        // The selection may span existing/future statements; prevent phantoms and lock-order
        // inversions with purchase corrections, asset changes and whole-ledger deletion.
        var member = guard.lockCurrentMemberExclusively(user);
        UUID book = member.getBookId();
        var now = clock.instant();
        String requestHash = hash(cardId + "|" + command);
        var claim = idempotency.claim(user, book, SCOPE, key, requestHash, now);
        if (!claim.fresh()) {
            if (!claim.requestHash().equals(requestHash)) throw error(409, "IDEMPOTENCY_KEY_REUSED", "같은 요청 키를 다른 결제에 사용할 수 없습니다.");
            if (claim.resourceId() != null && "COMPLETED".equals(claim.status())) return result(book, claim.resourceId());
            throw error(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "동일한 결제가 처리 중입니다.");
        }
        Card card = requireCard(book, cardId);
        if (card.archived()) throw error(409, "ASSET_ARCHIVED", "다시 사용한 뒤 결제할 수 있습니다.");
        LocalDate closing = latestClosing(today(), card.closingDay());
        if (!(card.token() + ":" + closing).equals(command.snapshotToken()))
            throw error(412, "CARD_PAYMENT_SELECTION_STALE", "미결제 내역이 변경되었습니다. 최신 내역을 확인해 주세요.");
        if (!settlements.isActivePaymentSource(book, command.settlementAssetId()))
            throw error(409, "CARD_SETTLEMENT_ASSET_INVALID", "사용 가능한 출금 계좌를 선택해 주세요.");
        boolean partial = "AMOUNT".equals(command.mode());
        if (!List.of("AMOUNT", "SELECTED").contains(command.mode())
                || !List.of("CLOSED", "ALL", "NONE").contains(command.baseSelection()))
            throw error(400, "CARD_PAYMENT_SELECTION_INVALID", "결제 방식을 확인해 주세요.");
        var totals = items.totals(book, cardId, closing);
        if (partial && (command.amountWon() == null || command.amountWon() <= 0 || command.amountWon() > totals.amountWon()))
            throw error(409, "CARD_PAYMENT_AMOUNT_INVALID", "결제 금액은 미결제 금액 이내로 입력해 주세요.");
        UUID batch = UuidV7.next();
        long budget = partial ? command.amountWon() : Long.MAX_VALUE;
        long paid = 0;
        // Read only a bounded chunk at a time. Paid rows disappear from the next chunk.
        while (budget > 0) {
            var rows = items.items(book, cardId, closing, null, 100,
                    partial ? "ALL" : command.baseSelection(),
                    partial ? List.of() : command.includedChargeIds(), partial ? List.of() : command.excludedChargeIds());
            if (rows.isEmpty()) break;
            Map<UUID, List<Item>> groups = new LinkedHashMap<>();
            long available = budget;
            for (Item row : rows) {
                if (available == 0) break;
                long applied = Math.min(available, row.remainingAmountWon());
                groups.computeIfAbsent(row.statementId(), ignored -> new ArrayList<>()).add(new Item(
                        row.chargeId(), row.statementId(), row.sourceTransactionId(), row.installmentNo(), row.installmentCount(),
                        row.occurredOn(), row.description(), row.cycleEnd(), row.dueOn(), applied, row.origin()));
                available -= applied;
            }
            for (var group : groups.entrySet()) {
                if (budget == 0) break;
                var statement = settlements.lockStatement(book, group.getKey());
                long amount = Math.min(budget, group.getValue().stream().mapToLong(Item::remainingAmountWon).sum());
                UUID payment = UuidV7.next();
                UUID transaction = UuidV7.next();
                transfers.create(new ManagedTransferPort.CreateCommand(transaction, book, TransferSubtype.CARD_SETTLEMENT,
                        command.paidOn(), amount, "카드 대금 결제", "SYSTEM", payment, card.ownerMemberId(), member.getId(), now,
                        List.of(new ManagedTransferPort.Posting(command.settlementAssetId(), -amount), new ManagedTransferPort.Posting(cardId, amount))));
                settlements.insertPayment(new CardSettlementRepository.PaymentWrite(payment, book, group.getKey(), "MANUAL",
                        command.settlementAssetId(), amount, command.paidOn(), transaction, member.getId(), now));
                long allocate = amount;
                for (Item row : group.getValue()) {
                    long applied = Math.min(allocate, row.remainingAmountWon());
                    if (applied == 0) break;
                    items.allocate(book, payment, batch, row, applied);
                    allocate -= applied;
                }
                settlements.recordUserPayment(group.getKey(), amount == statement.remainingAmountWon(), now);
                budget -= amount; paid += amount;
            }
        }
        if (paid == 0 || (partial && budget != 0)) throw error(409, "CARD_PAYMENT_AMOUNT_INVALID", "결제할 미결제 내역을 선택해 주세요.");
        idempotency.complete(user, SCOPE, key, batch, now);
        return result(book, batch);
    }

    private Result result(UUID book, UUID batch) {
        var payments = items.batch(book, batch);
        if (payments.isEmpty() || payments.stream().anyMatch(BatchPayment::cancelled))
            throw error(409, "CARD_PAYMENT_CANCELLED", "취소되거나 정정된 결제입니다. 최신 내역을 확인해 주세요.");
        return new Result(batch, payments.stream().mapToLong(BatchPayment::amountWon).sum(), payments);
    }
    private Card requireCard(UUID book, UUID card) {
        Card row = items.card(book, card);
        if (row == null) throw error(404, "ASSET_NOT_FOUND", "신용카드 자산을 찾을 수 없습니다.");
        return row;
    }
    public static LocalDate latestClosing(LocalDate today, int day) {
        YearMonth month = YearMonth.from(today);
        LocalDate end = month.atDay(Math.min(day, month.lengthOfMonth()));
        if (end.isAfter(today)) { month = month.minusMonths(1); end = month.atDay(Math.min(day, month.lengthOfMonth())); }
        return end;
    }
    private LocalDate today() { return LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul"))); }
    private String encode(Item row) { return Base64.getUrlEncoder().withoutPadding().encodeToString((row.dueOn() + "|" + row.occurredOn() + "|" + row.chargeId()).getBytes(StandardCharsets.UTF_8)); }
    private Cursor decode(String cursor) {
        if (cursor == null) return null;
        try { String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|");
            if (parts.length != 3) throw new IllegalArgumentException();
            return new Cursor(LocalDate.parse(parts[0]), LocalDate.parse(parts[1]), UUID.fromString(parts[2]));
        } catch (RuntimeException ex) { throw error(400, "CARD_PAYMENT_CURSOR_INVALID", "조회 위치를 확인해 주세요."); }
    }
    private String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    private ApiException error(int status, String code, String message) { return new ApiException(HttpStatus.valueOf(status), code, message); }
    public record Page(List<Item> items, String nextCursor, LocalDate recentClosingOn, String snapshotToken, Totals totals) {}
    public record Command(String snapshotToken, String mode, String baseSelection, List<UUID> includedChargeIds,
                          List<UUID> excludedChargeIds, Long amountWon, UUID settlementAssetId, LocalDate paidOn) {}
    public record Result(UUID batchId, long amountWon, List<BatchPayment> payments) {}
}
