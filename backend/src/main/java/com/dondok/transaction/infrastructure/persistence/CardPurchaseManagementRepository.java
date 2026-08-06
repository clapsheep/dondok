package com.dondok.transaction.infrastructure.persistence;

import com.dondok.common.id.UuidV7;
import com.dondok.transaction.domain.TransactionType;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CardPurchaseManagementRepository {
    private final JdbcTemplate jdbcTemplate;

    public CardPurchaseManagementRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public PurchaseGraph find(UUID bookId, UUID purchaseId) {
        return graph(bookId, purchaseId, false);
    }

    public PurchaseGraph findForUpdate(UUID bookId, UUID purchaseId) {
        PurchaseRow purchase = purchase(bookId, purchaseId, true);
        if (purchase == null) {
            return null;
        }
        jdbcTemplate.query("""
                select charge.id
                  from card_charge charge
                 where charge.book_id = ? and charge.source_transaction_id = ?
                 order by charge.statement_id, charge.id
                 for update
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, purchaseId);
        jdbcTemplate.query("""
                select statement.id
                  from card_statement statement
                 where statement.book_id = ?
                   and exists (
                       select 1 from card_charge charge
                        where charge.statement_id = statement.id
                          and charge.source_transaction_id = ?
                   )
                 order by statement.id
                 for update
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, purchaseId);
        jdbcTemplate.query("""
                select payment.id
                  from card_statement_payment payment
                 where payment.book_id = ?
                   and exists (
                       select 1 from card_charge charge
                        where charge.statement_id = payment.statement_id
                          and charge.source_transaction_id = ?
                   )
                 order by payment.paid_on desc, payment.id desc
                 for update
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, purchaseId);
        return graph(purchase);
    }

    public AnchorSettlement findAnchorSettlement(UUID bookId, UUID cardAssetId, boolean lock) {
        String lockClause = lock ? " for update of statement" : "";
        List<UUID> statementIds = jdbcTemplate.query("""
                select statement.id
                  from card_statement statement
                  join card_charge opening
                    on opening.book_id = statement.book_id
                   and opening.statement_id = statement.id
                   and opening.charge_origin = 'OPENING_BALANCE'
                 where statement.book_id = ? and statement.card_asset_id = ?
                 order by statement.id
                """ + lockClause, (rs, rowNum) -> rs.getObject(1, UUID.class), bookId, cardAssetId);
        if (statementIds.isEmpty()) {
            return null;
        }
        UUID statementId = statementIds.get(0);
        if (lock) {
            jdbcTemplate.query("""
                    select statement.id
                      from card_statement statement
                     where statement.book_id = ? and statement.card_asset_id = ?
                       and (
                           statement.id = ?
                           or exists (
                               select 1 from card_charge charge
                                where charge.statement_id = statement.id
                                  and charge.absorbed_by_balance_anchor
                           )
                       )
                     order by statement.id
                     for update
                    """, (rs, rowNum) -> rs.getObject(1, UUID.class),
                    bookId, cardAssetId, statementId);
            jdbcTemplate.query("""
                    select payment.id from card_statement_payment payment
                     where payment.book_id = ?
                       and exists (
                           select 1 from card_statement statement
                            where statement.id = payment.statement_id
                              and statement.card_asset_id = ?
                              and (
                                  statement.id = ?
                                  or exists (
                                      select 1 from card_charge charge
                                       where charge.statement_id = statement.id
                                         and charge.absorbed_by_balance_anchor
                                  )
                              )
                       )
                     order by payment.id
                     for update
                    """, (rs, rowNum) -> rs.getObject(1, UUID.class),
                    bookId, cardAssetId, statementId);
        }
        Long remainingAmountWon = jdbcTemplate.queryForObject("""
                select payment_amount_won
                  from card_statement_forecast
                 where book_id = ? and statement_id = ?
                """, Long.class, bookId, statementId);
        List<PaymentRow> payments = new ArrayList<>(jdbcTemplate.query("""
                select payment.id, payment.statement_id, payment.payment_type,
                       payment.settlement_asset_id, asset.name settlement_asset_name,
                       payment.amount_won, coalesce(returned.amount_won, 0) returned_amount_won,
                       payment.paid_on, payment.settlement_transaction_id,
                       payment.created_by_member_id
                  from card_statement_payment payment
                  join asset on asset.book_id = payment.book_id
                            and asset.id = payment.settlement_asset_id
                  left join lateral (
                      select sum(allocation.amount_won) amount_won
                        from card_purchase_refund_payment allocation
                       where allocation.statement_payment_id = payment.id
                  ) returned on true
                 where payment.book_id = ? and payment.statement_id = ?
                 order by payment.paid_on desc, payment.id desc
                """, (rs, rowNum) -> new PaymentRow(
                rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getString("payment_type"), rs.getObject("settlement_asset_id", UUID.class),
                rs.getString("settlement_asset_name"), rs.getLong("amount_won"),
                rs.getLong("returned_amount_won"), rs.getObject("paid_on", LocalDate.class),
                rs.getObject("settlement_transaction_id", UUID.class),
                rs.getObject("created_by_member_id", UUID.class)), bookId, statementId));
        List<UUID> absorbedStatementIds = jdbcTemplate.query("""
                select distinct charge.statement_id
                  from card_charge charge
                 where charge.book_id = ? and charge.card_asset_id = ?
                   and charge.absorbed_by_balance_anchor
                   and charge.statement_id <> ?
                 order by charge.statement_id
                """, (rs, rowNum) -> rs.getObject(1, UUID.class),
                bookId, cardAssetId, statementId);
        for (UUID absorbedStatementId : absorbedStatementIds) {
            Long grossAmountWon = jdbcTemplate.queryForObject("""
                    select gross_amount_won from card_statement_forecast
                     where book_id = ? and statement_id = ?
                    """, Long.class, bookId, absorbedStatementId);
            List<PaymentRow> statementPayments = jdbcTemplate.query("""
                    select payment.id, payment.statement_id, payment.payment_type,
                           payment.settlement_asset_id, asset.name settlement_asset_name,
                           payment.amount_won, coalesce(returned.amount_won, 0) returned_amount_won,
                           payment.paid_on, payment.settlement_transaction_id,
                           payment.created_by_member_id
                      from card_statement_payment payment
                      join asset on asset.book_id = payment.book_id
                                and asset.id = payment.settlement_asset_id
                      left join lateral (
                          select sum(allocation.amount_won) amount_won
                            from card_purchase_refund_payment allocation
                           where allocation.statement_payment_id = payment.id
                      ) returned on true
                     where payment.book_id = ? and payment.statement_id = ?
                     order by payment.paid_on desc, payment.id desc
                    """, (rs, rowNum) -> new PaymentRow(
                    rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                    rs.getString("payment_type"), rs.getObject("settlement_asset_id", UUID.class),
                    rs.getString("settlement_asset_name"), rs.getLong("amount_won"),
                    rs.getLong("returned_amount_won"), rs.getObject("paid_on", LocalDate.class),
                    rs.getObject("settlement_transaction_id", UUID.class),
                    rs.getObject("created_by_member_id", UUID.class)), bookId, absorbedStatementId);
            long paidAmountWon = statementPayments.stream()
                    .mapToLong(PaymentRow::effectiveAmountWon).sum();
            long anchorPaidAmountWon = Math.max(
                    paidAmountWon - (grossAmountWon == null ? 0 : grossAmountWon), 0);
            for (PaymentRow payment : statementPayments) {
                if (anchorPaidAmountWon == 0) {
                    break;
                }
                long eligibleAmountWon = Math.min(anchorPaidAmountWon, payment.effectiveAmountWon());
                if (eligibleAmountWon > 0) {
                    payments.add(new PaymentRow(
                            payment.paymentId(), payment.statementId(), payment.paymentType(),
                            payment.settlementAssetId(), payment.settlementAssetName(),
                            eligibleAmountWon, 0, payment.paidOn(),
                            payment.settlementTransactionId(), payment.createdByMemberId()));
                    anchorPaidAmountWon -= eligibleAmountWon;
                }
            }
        }
        payments.sort(Comparator.comparing(PaymentRow::paidOn).reversed()
                .thenComparing(PaymentRow::paymentId, Comparator.reverseOrder()));
        return new AnchorSettlement(statementId,
                remainingAmountWon == null ? 0 : remainingAmountWon, payments);
    }

    private PurchaseGraph graph(UUID bookId, UUID purchaseId, boolean lock) {
        PurchaseRow purchase = purchase(bookId, purchaseId, lock);
        return purchase == null ? null : graph(purchase);
    }

    private PurchaseGraph graph(PurchaseRow purchase) {
        List<ChargeRow> charges = jdbcTemplate.query("""
                select charge.id, charge.statement_id, charge.card_asset_id,
                       charge.installment_no, charge.installment_count,
                       charge.principal_amount_won, charge.expected_settlement_on,
                       charge.absorbed_by_balance_anchor,
                       coalesce(refunded.amount_won, 0) refunded_amount_won
                  from card_charge charge
                  left join lateral (
                      select sum(allocation.amount_won) amount_won
                        from card_purchase_refund_charge allocation
                       where allocation.card_charge_id = charge.id
                  ) refunded on true
                 where charge.book_id = ? and charge.source_transaction_id = ?
                 order by charge.expected_settlement_on, charge.installment_no, charge.id
                """, (rs, rowNum) -> new ChargeRow(
                rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getObject("card_asset_id", UUID.class), rs.getInt("installment_no"),
                rs.getInt("installment_count"), rs.getLong("principal_amount_won"),
                rs.getLong("refunded_amount_won"),
                rs.getObject("expected_settlement_on", LocalDate.class),
                rs.getBoolean("absorbed_by_balance_anchor")),
                purchase.bookId(), purchase.transactionId());
        List<StatementRow> statements = jdbcTemplate.query("""
                select statement.id, statement.card_asset_id, statement.cycle_start,
                       statement.cycle_end, statement.due_on, statement.status,
                       forecast.gross_amount_won, forecast.paid_amount_won,
                       forecast.payment_amount_won, statement.version
                  from card_statement statement
                  join card_statement_forecast forecast on forecast.statement_id = statement.id
                 where statement.book_id = ?
                   and exists (
                       select 1 from card_charge charge
                        where charge.statement_id = statement.id
                          and charge.source_transaction_id = ?
                   )
                 order by statement.due_on, statement.id
                """, (rs, rowNum) -> new StatementRow(
                rs.getObject("id", UUID.class), rs.getObject("card_asset_id", UUID.class),
                rs.getObject("cycle_start", LocalDate.class),
                rs.getObject("cycle_end", LocalDate.class),
                rs.getObject("due_on", LocalDate.class), rs.getString("status"),
                rs.getLong("gross_amount_won"), rs.getLong("paid_amount_won"),
                rs.getLong("payment_amount_won"), rs.getLong("version")),
                purchase.bookId(), purchase.transactionId());
        List<PaymentRow> payments = jdbcTemplate.query("""
                select payment.id, payment.statement_id, payment.payment_type,
                       payment.settlement_asset_id, asset.name settlement_asset_name,
                       payment.amount_won, coalesce(returned.amount_won, 0) returned_amount_won,
                       payment.paid_on, payment.settlement_transaction_id,
                       payment.created_by_member_id
                  from card_statement_payment payment
                  join asset on asset.book_id = payment.book_id
                            and asset.id = payment.settlement_asset_id
                  left join lateral (
                      select sum(allocation.amount_won) amount_won
                        from card_purchase_refund_payment allocation
                       where allocation.statement_payment_id = payment.id
                  ) returned on true
                 where payment.book_id = ?
                   and exists (
                       select 1 from card_charge charge
                        where charge.statement_id = payment.statement_id
                          and charge.source_transaction_id = ?
                   )
                 order by payment.paid_on desc, payment.id desc
                """, (rs, rowNum) -> new PaymentRow(
                rs.getObject("id", UUID.class), rs.getObject("statement_id", UUID.class),
                rs.getString("payment_type"), rs.getObject("settlement_asset_id", UUID.class),
                rs.getString("settlement_asset_name"), rs.getLong("amount_won"),
                rs.getLong("returned_amount_won"), rs.getObject("paid_on", LocalDate.class),
                rs.getObject("settlement_transaction_id", UUID.class),
                rs.getObject("created_by_member_id", UUID.class)),
                purchase.bookId(), purchase.transactionId());
        List<RefundRow> refunds = jdbcTemplate.query("""
                select refund.id, refund.refund_transaction_id, refund.refunded_on,
                       refund.amount_won, refund_transaction.excluded_from_statistics,
                       refund.amount_won - coalesce(returned.amount_won, 0) unpaid_card_reduction_won
                  from card_purchase_refund refund
                  join ledger_transaction refund_transaction
                    on refund_transaction.book_id = refund.book_id
                   and refund_transaction.id = refund.refund_transaction_id
                  left join lateral (
                      select sum(allocation.amount_won) amount_won
                        from card_purchase_refund_payment allocation
                       where allocation.refund_id = refund.id
                  ) returned on true
                 where refund.book_id = ? and refund.purchase_transaction_id = ?
                 order by refund.refunded_on, refund.id
                """, (rs, rowNum) -> new RefundRow(
                rs.getObject("id", UUID.class), rs.getObject("refund_transaction_id", UUID.class),
                rs.getObject("refunded_on", LocalDate.class), rs.getLong("amount_won"),
                rs.getBoolean("excluded_from_statistics"), rs.getLong("unpaid_card_reduction_won")),
                purchase.bookId(), purchase.transactionId());
        List<RefundAccountRow> refundAccounts = jdbcTemplate.query("""
                select allocation.refund_id, payment.settlement_asset_id,
                       asset.name settlement_asset_name, sum(allocation.amount_won) amount_won
                  from card_purchase_refund_payment allocation
                  join card_statement_payment payment on payment.id = allocation.statement_payment_id
                  join asset on asset.book_id = payment.book_id
                            and asset.id = payment.settlement_asset_id
                  join card_purchase_refund refund on refund.id = allocation.refund_id
                 where refund.book_id = ? and refund.purchase_transaction_id = ?
                 group by allocation.refund_id, payment.settlement_asset_id, asset.name
                 order by allocation.refund_id, payment.settlement_asset_id
                """, (rs, rowNum) -> new RefundAccountRow(
                rs.getObject("refund_id", UUID.class),
                rs.getObject("settlement_asset_id", UUID.class),
                rs.getString("settlement_asset_name"), rs.getLong("amount_won")),
                purchase.bookId(), purchase.transactionId());
        return new PurchaseGraph(purchase, charges, statements, payments, refunds, refundAccounts);
    }

    private PurchaseRow purchase(UUID bookId, UUID purchaseId, boolean lock) {
        String lockClause = lock ? " for update of purchase" : "";
        List<PurchaseRow> rows = jdbcTemplate.query("""
                select purchase.id, purchase.book_id, purchase.transaction_type,
                       purchase.source_type, purchase.occurred_on, purchase.amount_won,
                       purchase.category_id, purchase.performed_by_member_id,
                       purchase.primary_asset_id, purchase.description,
                       purchase.created_by_member_id, purchase.version,
                       snapshot.card_asset_id, asset.name card_asset_name,
                       snapshot.statement_closing_day, snapshot.payment_day,
                       snapshot.payment_month_offset, snapshot.installment_count
                  from ledger_transaction purchase
                  join card_purchase_billing_snapshot snapshot
                    on snapshot.book_id = purchase.book_id
                   and snapshot.purchase_transaction_id = purchase.id
                  join asset on asset.book_id = snapshot.book_id
                            and asset.id = snapshot.card_asset_id
                 where purchase.book_id = ? and purchase.id = ? and purchase.deleted_at is null
                """ + lockClause, (rs, rowNum) -> new PurchaseRow(
                rs.getObject("id", UUID.class), rs.getObject("book_id", UUID.class),
                TransactionType.valueOf(rs.getString("transaction_type")), rs.getString("source_type"),
                rs.getObject("occurred_on", LocalDate.class), rs.getLong("amount_won"),
                rs.getObject("category_id", UUID.class),
                rs.getObject("performed_by_member_id", UUID.class),
                rs.getObject("primary_asset_id", UUID.class), rs.getString("description"),
                rs.getObject("created_by_member_id", UUID.class), rs.getLong("version"),
                rs.getObject("card_asset_id", UUID.class), rs.getString("card_asset_name"),
                rs.getInt("statement_closing_day"), rs.getInt("payment_day"),
                rs.getInt("payment_month_offset"), rs.getInt("installment_count")),
                bookId, purchaseId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void insertRefund(
            RefundWrite refund,
            List<ChargeAllocation> chargeAllocations,
            List<PaymentAllocation> paymentAllocations,
            List<AccountAmount> accountReturns,
            long unpaidCardReductionWon
    ) {
        List<TransactionJdbcRepository.PostingWrite> postings = new ArrayList<>();
        if (unpaidCardReductionWon > 0) {
            postings.add(new TransactionJdbcRepository.PostingWrite(
                    refund.cardAssetId(), unpaidCardReductionWon));
        }
        accountReturns.stream()
                .sorted(Comparator.comparing(AccountAmount::assetId))
                .forEach(account -> postings.add(new TransactionJdbcRepository.PostingWrite(
                        account.assetId(), account.amountWon())));
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, transfer_subtype, occurred_on, amount_won,
                    category_id, performed_by_member_id, primary_asset_id, description,
                    source_type, source_id, excluded_from_statistics,
                    created_by_member_id, updated_by_member_id,
                    created_at, updated_at, version
                ) values (?, ?, 'EXPENSE', null, ?, ?, ?, ?, ?, ?, 'CARD_REFUND', ?, ?, ?, ?, ?, ?, 0)
                """, refund.refundTransactionId(), refund.bookId(), Date.valueOf(refund.refundedOn()),
                refund.amountWon(), refund.categoryId(), refund.performedByMemberId(),
                refund.cardAssetId(), refund.description(), refund.refundId(),
                refund.excludedFromStatistics(), refund.createdByMemberId(), refund.createdByMemberId(),
                Timestamp.from(refund.now()), Timestamp.from(refund.now()));
        short lineNo = 1;
        for (TransactionJdbcRepository.PostingWrite posting : postings) {
            jdbcTemplate.update("""
                    insert into transaction_posting (
                        transaction_id, line_no, book_id, asset_id, delta_won
                    ) values (?, ?, ?, ?, ?)
                    """, refund.refundTransactionId(), lineNo++, refund.bookId(),
                    posting.assetId(), posting.deltaWon());
        }
        jdbcTemplate.update("""
                insert into card_purchase_refund (
                    id, book_id, purchase_transaction_id, refund_transaction_id,
                    refunded_on, amount_won, created_by_member_id, created_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
                """, refund.refundId(), refund.bookId(), refund.purchaseTransactionId(),
                refund.refundTransactionId(), Date.valueOf(refund.refundedOn()), refund.amountWon(),
                refund.createdByMemberId(), Timestamp.from(refund.now()));
        for (ChargeAllocation allocation : chargeAllocations) {
            jdbcTemplate.update("""
                    insert into card_purchase_refund_charge (
                        book_id, refund_id, card_charge_id, amount_won
                    ) values (?, ?, ?, ?)
                    """, refund.bookId(), refund.refundId(), allocation.chargeId(), allocation.amountWon());
        }
        for (PaymentAllocation allocation : paymentAllocations) {
            jdbcTemplate.update("""
                    insert into card_purchase_refund_payment (
                        book_id, refund_id, statement_payment_id, amount_won
                    ) values (?, ?, ?, ?)
                    """, refund.bookId(), refund.refundId(), allocation.paymentId(), allocation.amountWon());
        }
        int updated = jdbcTemplate.update("""
                update ledger_transaction
                   set version = version + 1, updated_by_member_id = ?, updated_at = ?
                 where book_id = ? and id = ? and version = ? and deleted_at is null
                """, refund.createdByMemberId(), Timestamp.from(refund.now()), refund.bookId(),
                refund.purchaseTransactionId(), refund.expectedVersion());
        if (updated != 1) {
            throw new IllegalStateException("locked card purchase refund did not update its version");
        }
        List<UUID> touchedStatementIds = new ArrayList<>(chargeAllocations.stream()
                .map(ChargeAllocation::statementId).toList());
        paymentAllocations.stream()
                .map(PaymentAllocation::paymentId)
                .map(paymentId -> jdbcTemplate.queryForObject(
                        "select statement_id from card_statement_payment where id = ?",
                        UUID.class, paymentId))
                .forEach(touchedStatementIds::add);
        List<UUID> openingStatementIds = jdbcTemplate.query("""
                select statement_id from card_charge
                 where book_id = ? and card_asset_id = ? and charge_origin = 'OPENING_BALANCE'
                """, (rs, rowNum) -> rs.getObject(1, UUID.class),
                refund.bookId(), refund.cardAssetId());
        touchedStatementIds.addAll(openingStatementIds);
        touchStatements(touchedStatementIds.stream().distinct().toList(), refund.now());
    }

    public void correctPurchase(CorrectionWrite write) {
        List<UUID> oldStatementIds = write.oldGraph().charges().stream()
                .map(ChargeRow::statementId).distinct().toList();
        jdbcTemplate.update("""
                delete from card_purchase_refund_charge allocation
                 where exists (
                     select 1 from card_purchase_refund refund
                      where refund.id = allocation.refund_id
                        and refund.purchase_transaction_id = ?
                 )
                """, write.purchaseId());
        jdbcTemplate.update("delete from card_charge where source_transaction_id = ?", write.purchaseId());

        Map<StatementKey, UUID> statementIds = new LinkedHashMap<>();
        for (InstallmentTarget installment : write.installments()) {
            StatementKey key = new StatementKey(
                    installment.cycleStart(), installment.cycleEnd(), installment.dueOn());
            UUID statementId = statementIds.get(key);
            if (statementId == null) {
                UUID candidate = UuidV7.next();
                jdbcTemplate.update("""
                        insert into card_statement (
                            id, book_id, card_asset_id, cycle_start, cycle_end, due_on,
                            status, billed_amount_won, created_at, updated_at, version
                        ) values (?, ?, ?, ?, ?, ?, 'OPEN', 0, ?, ?, 0)
                        on conflict (card_asset_id, cycle_start, cycle_end) do nothing
                        """, candidate, write.bookId(), write.cardAssetId(),
                        Date.valueOf(installment.cycleStart()), Date.valueOf(installment.cycleEnd()),
                        Date.valueOf(installment.dueOn()), Timestamp.from(write.now()), Timestamp.from(write.now()));
                statementId = jdbcTemplate.queryForObject("""
                        select id from card_statement
                         where card_asset_id = ? and cycle_start = ? and cycle_end = ?
                         for update
                        """, UUID.class, write.cardAssetId(), Date.valueOf(installment.cycleStart()),
                        Date.valueOf(installment.cycleEnd()));
                statementIds.put(key, statementId);
            }
            UUID chargeId = UuidV7.next();
            jdbcTemplate.update("""
                    insert into card_charge (
                        id, book_id, source_transaction_id, card_asset_id, statement_id,
                        charge_origin, installment_no, installment_count, principal_amount_won,
                        expected_settlement_on, absorbed_by_balance_anchor, created_at
                    ) values (?, ?, ?, ?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?)
                    """, chargeId, write.bookId(), write.purchaseId(), write.cardAssetId(), statementId,
                    installment.number(), write.installments().size(), installment.amountWon(),
                    Date.valueOf(installment.dueOn()), write.absorbedByBalanceAnchor(),
                    Timestamp.from(write.now()));
            installment.chargeIdHolder().set(chargeId, statementId);
        }

        jdbcTemplate.update("""
                update card_purchase_billing_snapshot
                   set card_asset_id = ?, statement_closing_day = ?, payment_day = ?,
                       payment_month_offset = ?, installment_count = ?, updated_at = ?
                 where book_id = ? and purchase_transaction_id = ?
                """, write.cardAssetId(), write.statementClosingDay(), write.paymentDay(),
                write.paymentMonthOffset(), write.installments().size(), Timestamp.from(write.now()),
                write.bookId(), write.purchaseId());
        int updated = jdbcTemplate.update("""
                update ledger_transaction
                   set occurred_on = ?, amount_won = ?, category_id = ?,
                       performed_by_member_id = ?, primary_asset_id = ?, description = ?,
                       excluded_from_statistics = ?,
                       updated_by_member_id = ?, updated_at = ?, version = version + 1
                 where book_id = ? and id = ? and version = ? and deleted_at is null
                """, Date.valueOf(write.occurredOn()), write.amountWon(), write.categoryId(),
                write.performedByMemberId(), write.cardAssetId(), write.description(),
                write.excludedFromStatistics(), write.updatedByMemberId(), Timestamp.from(write.now()), write.bookId(),
                write.purchaseId(), write.expectedVersion());
        if (updated != 1) {
            throw new IllegalStateException("locked card purchase correction did not update its purchase");
        }
        jdbcTemplate.update("delete from transaction_posting where transaction_id = ?", write.purchaseId());
        jdbcTemplate.update("""
                insert into transaction_posting (
                    transaction_id, line_no, book_id, asset_id, delta_won
                ) values (?, 1, ?, ?, ?)
                """, write.purchaseId(), write.bookId(), write.cardAssetId(), -write.amountWon());

        for (HistoricalRefundTarget allocation : write.historicalRefundAllocations()) {
            jdbcTemplate.update("""
                    insert into card_purchase_refund_charge (
                        book_id, refund_id, card_charge_id, amount_won
                    ) values (?, ?, ?, ?)
                    """, write.bookId(), allocation.refundId(),
                    allocation.charge().chargeId(), allocation.amountWon());
        }
        if (!write.oldGraph().purchase().cardAssetId().equals(write.cardAssetId())) {
            for (RefundRow refund : write.oldGraph().refunds()) {
                if (refund.unpaidCardReductionWon() > 0) {
                    jdbcTemplate.update("""
                            update transaction_posting
                               set asset_id = ?
                             where transaction_id = ?
                               and asset_id = ?
                               and delta_won > 0
                            """, write.cardAssetId(), refund.refundTransactionId(),
                            write.oldGraph().purchase().cardAssetId());
                }
                jdbcTemplate.update("""
                        update ledger_transaction
                           set primary_asset_id = ?, updated_at = ?, version = version + 1
                         where id = ?
                        """, write.cardAssetId(), Timestamp.from(write.now()), refund.refundTransactionId());
            }
        }
        List<UUID> allStatementIds = new ArrayList<>(oldStatementIds);
        allStatementIds.addAll(statementIds.values());
        recalculateStatements(allStatementIds.stream().distinct().toList(), write.now());
        applyPaymentReductions(write.paymentReductions(), write.updatedByMemberId(), write.now());
        touchStatements(write.paymentReductions().stream()
                .map(PaymentReduction::statementId).distinct().toList(), write.now());
        reconcileStatementStatuses(allStatementIds.stream().distinct().toList(), write.now());
    }

    private void applyPaymentReductions(
            List<PaymentReduction> reductions,
            UUID editorMemberId,
            Instant now
    ) {
        for (PaymentReduction reduction : reductions) {
            if (reduction.newAmountWon() == 0) {
                jdbcTemplate.update("delete from card_statement_payment where id = ?", reduction.paymentId());
                jdbcTemplate.update("""
                        update ledger_transaction
                           set deleted_at = ?, deleted_by_member_id = ?, updated_by_member_id = ?,
                               updated_at = ?, version = version + 1
                         where id = ? and deleted_at is null
                        """, Timestamp.from(now), editorMemberId, editorMemberId,
                        Timestamp.from(now), reduction.settlementTransactionId());
            } else {
                jdbcTemplate.update("update card_statement_payment set amount_won = ? where id = ?",
                        reduction.newAmountWon(), reduction.paymentId());
                jdbcTemplate.update("""
                        update ledger_transaction
                           set amount_won = ?, updated_by_member_id = ?, updated_at = ?, version = version + 1
                         where id = ? and deleted_at is null
                        """, reduction.newAmountWon(), editorMemberId, Timestamp.from(now),
                        reduction.settlementTransactionId());
                jdbcTemplate.update("delete from transaction_posting where transaction_id = ?",
                        reduction.settlementTransactionId());
                jdbcTemplate.update("""
                        insert into transaction_posting (
                            transaction_id, line_no, book_id, asset_id, delta_won
                        ) values (?, 1, ?, ?, ?), (?, 2, ?, ?, ?)
                        """, reduction.settlementTransactionId(), reduction.bookId(),
                        reduction.settlementAssetId(), -reduction.newAmountWon(),
                        reduction.settlementTransactionId(), reduction.bookId(),
                        reduction.cardAssetId(), reduction.newAmountWon());
            }
        }
    }

    private void recalculateStatements(List<UUID> statementIds, Instant now) {
        touchStatements(statementIds, now);
    }

    private void touchStatements(List<UUID> statementIds, Instant now) {
        for (UUID statementId : statementIds.stream().distinct().sorted().toList()) {
            jdbcTemplate.update("""
                    update card_statement statement
                       set billed_amount_won = coalesce((
                               select sum(charge.principal_amount_won)
                                 from card_charge charge
                                where charge.statement_id = statement.id
                                  and not charge.absorbed_by_balance_anchor
                           ), 0),
                           updated_at = ?, version = version + 1
                     where statement.id = ?
                    """, Timestamp.from(now), statementId);
        }
    }

    private void reconcileStatementStatuses(List<UUID> statementIds, Instant now) {
        LocalDate today = now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate();
        for (UUID statementId : statementIds.stream().distinct().sorted().toList()) {
            jdbcTemplate.update("""
                    update card_statement statement
                       set status = case when statement.due_on > ? then 'OPEN' else 'FINALIZED' end,
                           finalized_at = case
                               when statement.due_on > ? then null
                               else coalesce(statement.finalized_at, ?)
                           end,
                           settled_at = null,
                           updated_at = ?, version = version + 1
                      from card_statement_forecast forecast
                     where statement.id = ?
                       and forecast.statement_id = statement.id
                       and statement.status = 'PAID'
                       and forecast.payment_amount_won > 0
                    """, Date.valueOf(today), Date.valueOf(today), Timestamp.from(now),
                    Timestamp.from(now), statementId);
        }
    }

    public record PurchaseRow(
            UUID transactionId,
            UUID bookId,
            TransactionType type,
            String sourceType,
            LocalDate occurredOn,
            long amountWon,
            UUID categoryId,
            UUID performedByMemberId,
            UUID primaryAssetId,
            String description,
            UUID createdByMemberId,
            long version,
            UUID cardAssetId,
            String cardAssetName,
            int statementClosingDay,
            int paymentDay,
            int paymentMonthOffset,
            int installmentCount
    ) {
    }

    public record ChargeRow(
            UUID chargeId,
            UUID statementId,
            UUID cardAssetId,
            int installmentNo,
            int installmentCount,
            long principalAmountWon,
            long refundedAmountWon,
            LocalDate expectedSettlementOn,
            boolean absorbedByBalanceAnchor
    ) {
        public long refundableAmountWon() {
            return principalAmountWon - refundedAmountWon;
        }
    }

    public record StatementRow(
            UUID statementId,
            UUID cardAssetId,
            LocalDate cycleStart,
            LocalDate cycleEnd,
            LocalDate dueOn,
            String status,
            long grossAmountWon,
            long paidAmountWon,
            long paymentAmountWon,
            long version
    ) {
    }

    public record PaymentRow(
            UUID paymentId,
            UUID statementId,
            String paymentType,
            UUID settlementAssetId,
            String settlementAssetName,
            long amountWon,
            long returnedAmountWon,
            LocalDate paidOn,
            UUID settlementTransactionId,
            UUID createdByMemberId
    ) {
        public long effectiveAmountWon() {
            return amountWon - returnedAmountWon;
        }
    }

    public record AnchorSettlement(
            UUID statementId,
            long remainingAmountWon,
            List<PaymentRow> payments
    ) {
        public String concurrencyState() {
            StringBuilder state = new StringBuilder().append(statementId)
                    .append(':').append(remainingAmountWon);
            payments.forEach(payment -> state.append("|ap:").append(payment.paymentId())
                    .append(':').append(payment.amountWon())
                    .append(':').append(payment.returnedAmountWon())
                    .append(':').append(payment.paidOn()));
            return state.toString();
        }
    }

    public record RefundRow(
            UUID refundId,
            UUID refundTransactionId,
            LocalDate refundedOn,
            long amountWon,
            boolean excludedFromStatistics,
            long unpaidCardReductionWon
    ) {
    }

    public record RefundAccountRow(
            UUID refundId,
            UUID assetId,
            String assetName,
            long amountWon
    ) {
    }

    public record PurchaseGraph(
            PurchaseRow purchase,
            List<ChargeRow> charges,
            List<StatementRow> statements,
            List<PaymentRow> payments,
            List<RefundRow> refunds,
            List<RefundAccountRow> refundAccounts
    ) {
        public long refundableAmountWon() {
            return charges.stream().mapToLong(ChargeRow::refundableAmountWon).sum();
        }

        public String concurrencyState() {
            StringBuilder state = new StringBuilder().append(purchase.transactionId())
                    .append('|').append(purchase.version());
            charges.forEach(charge -> state.append("|c:").append(charge.chargeId())
                    .append(':').append(charge.principalAmountWon())
                    .append(':').append(charge.refundedAmountWon())
                    .append(':').append(charge.absorbedByBalanceAnchor()));
            statements.forEach(statement -> state.append("|s:").append(statement.statementId())
                    .append(':').append(statement.version())
                    .append(':').append(statement.status())
                    .append(':').append(statement.grossAmountWon())
                    .append(':').append(statement.paidAmountWon()));
            payments.forEach(payment -> state.append("|p:").append(payment.paymentId())
                    .append(':').append(payment.amountWon())
                    .append(':').append(payment.returnedAmountWon())
                    .append(':').append(payment.paidOn()));
            return state.toString();
        }
    }

    public record ChargeAllocation(UUID chargeId, UUID statementId, long amountWon) {
    }

    public record PaymentAllocation(UUID paymentId, long amountWon) {
    }

    public record AccountAmount(UUID assetId, String assetName, long amountWon) {
    }

    public record RefundWrite(
            UUID refundId,
            UUID refundTransactionId,
            UUID purchaseTransactionId,
            UUID bookId,
            UUID cardAssetId,
            UUID categoryId,
            UUID performedByMemberId,
            UUID createdByMemberId,
            LocalDate refundedOn,
            long amountWon,
            String description,
            boolean excludedFromStatistics,
            long expectedVersion,
            Instant now
    ) {
    }

    public record ChargeIdHolder(UUID[] values) {
        public ChargeIdHolder() {
            this(new UUID[2]);
        }

        public void set(UUID chargeId, UUID statementId) {
            values[0] = chargeId;
            values[1] = statementId;
        }

        public UUID chargeId() {
            return values[0];
        }

        public UUID statementId() {
            return values[1];
        }
    }

    public record InstallmentTarget(
            int number,
            long amountWon,
            LocalDate cycleStart,
            LocalDate cycleEnd,
            LocalDate dueOn,
            ChargeIdHolder chargeIdHolder
    ) {
    }

    public record HistoricalRefundTarget(UUID refundId, ChargeIdHolder charge, long amountWon) {
    }

    public record PaymentReduction(
            UUID paymentId,
            UUID statementId,
            UUID settlementTransactionId,
            UUID bookId,
            UUID settlementAssetId,
            UUID cardAssetId,
            long newAmountWon
    ) {
    }

    public record CorrectionWrite(
            UUID purchaseId,
            UUID bookId,
            UUID cardAssetId,
            LocalDate occurredOn,
            long amountWon,
            UUID categoryId,
            UUID performedByMemberId,
            String description,
            boolean excludedFromStatistics,
            int statementClosingDay,
            int paymentDay,
            int paymentMonthOffset,
            long expectedVersion,
            UUID updatedByMemberId,
            Instant now,
            boolean absorbedByBalanceAnchor,
            List<InstallmentTarget> installments,
            List<HistoricalRefundTarget> historicalRefundAllocations,
            List<PaymentReduction> paymentReductions,
            PurchaseGraph oldGraph
    ) {
    }

    private record StatementKey(LocalDate start, LocalDate end, LocalDate dueOn) {
    }
}
