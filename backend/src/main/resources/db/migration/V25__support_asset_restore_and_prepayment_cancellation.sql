alter table card_statement_payment
    add column cancelled_at timestamptz,
    add column cancelled_by_member_id uuid;

alter table card_statement_payment
    add constraint fk_card_statement_payment_canceller
        foreign key (book_id, cancelled_by_member_id)
        references ledger_member(book_id, id),
    add constraint ck_card_statement_payment_cancellation
        check ((cancelled_at is null) = (cancelled_by_member_id is null));

comment on column card_statement_payment.cancelled_at is
    '사용자가 잘못 기록한 PREPAYMENT를 전용 command로 취소한 시각. 연결 거래는 같은 command에서 soft delete한다.';
