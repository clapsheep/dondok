package com.dondok.transaction.infrastructure.persistence;

import com.dondok.transaction.application.ManagedTransferPort;
import com.dondok.transaction.domain.TransactionType;
import java.sql.Date;
import java.sql.Timestamp;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcManagedTransferAdapter implements ManagedTransferPort {
    private final JdbcTemplate jdbcTemplate;
    private final TransactionJdbcRepository transactions;

    public JdbcManagedTransferAdapter(JdbcTemplate jdbcTemplate, TransactionJdbcRepository transactions) {
        this.jdbcTemplate = jdbcTemplate;
        this.transactions = transactions;
    }

    @Override
    public ManagedTransfer create(CreateCommand command) {
        jdbcTemplate.update("""
                insert into ledger_transaction (
                    id, book_id, transaction_type, transfer_subtype, occurred_on, amount_won,
                    description, source_type, source_id, created_by_member_id, updated_by_member_id,
                    created_at, updated_at, version
                ) values (?, ?, 'TRANSFER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, command.transactionId(), command.bookId(), command.transferSubtype().name(),
                Date.valueOf(command.occurredOn()), command.amountWon(), command.description(),
                command.sourceType(), command.sourceId(), command.createdByMemberId(),
                command.createdByMemberId(), Timestamp.from(command.now()), Timestamp.from(command.now()));
        short lineNo = 1;
        for (Posting posting : command.postings()) {
            jdbcTemplate.update("""
                    insert into transaction_posting (
                        transaction_id, line_no, book_id, asset_id, delta_won
                    ) values (?, ?, ?, ?, ?)
                    """, command.transactionId(), lineNo++, command.bookId(),
                    posting.assetId(), posting.deltaWon());
        }
        return required(command.bookId(), command.transactionId());
    }

    @Override
    public ManagedTransfer find(java.util.UUID bookId, java.util.UUID transactionId) {
        TransactionJdbcRepository.TransactionRows rows = transactions.find(bookId, transactionId);
        return rows == null ? null : map(rows);
    }

    private ManagedTransfer required(java.util.UUID bookId, java.util.UUID transactionId) {
        ManagedTransfer result = find(bookId, transactionId);
        if (result == null) {
            throw new IllegalStateException("managed transfer was not persisted");
        }
        return result;
    }

    private ManagedTransfer map(TransactionJdbcRepository.TransactionRows rows) {
        TransactionJdbcRepository.ReadRow row = rows.transaction();
        if (row.type() != TransactionType.TRANSFER || row.transferSubtype() == null) {
            throw new IllegalStateException("managed transfer has invalid transaction shape");
        }
        Member creator = row.creatorId() == null
                ? null : new Member(row.creatorId(), row.creatorName());
        List<Posting> postings = rows.postings().stream()
                .map(posting -> new Posting(posting.assetId(), posting.assetName(), posting.deltaWon()))
                .toList();
        return new ManagedTransfer(
                row.transactionId(), row.transferSubtype(), row.occurredOn(), row.amountWon(),
                row.description(), creator, postings, row.version(), row.createdAt(), row.updatedAt());
    }
}
