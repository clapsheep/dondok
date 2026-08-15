# Dondok 백엔드 유지보수 설계 원칙

## 1. 추상화 기준

유지보수성은 상속의 개수가 아니라 변경 이유가 같은 코드가 같은 경계에 모여 있는지로 판단한다.

자산·거래는 확장 가능성이 높지만 JPA 엔티티 상속은 기본 선택으로 사용하지 않는다.

- 공통 영속 데이터: 단일 aggregate/entity
- 특수 데이터: 1:1 composition 확장 테이블
- 달라지는 동작: sealed interface 또는 Strategy/Policy
- 객체 생성: Factory
- 유스케이스와 트랜잭션 조율: Application Service
- 기술 공통 필드: 한 단계의 `@MappedSuperclass` 허용

JPA의 `SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS` 상속은 각각 nullable 컬럼 증가, 매 조회 join, 타입 변경 난이도를 만든다. 카드처럼 특수 속성이 있는 경우 `Asset + CardSetting` composition이 스키마와 코드 변화에 더 강하다.

## 2. 모듈 구조

```text
com.dondok
├── user
├── membership       # 초대 URL·코드, 동등한 멤버십
├── ledger
├── asset            # Asset, AssetType, CardSetting, behavior
├── category
├── transaction      # Transaction, Posting, CardCharge
├── settlement       # CardStatement, Schedule, worker
├── statistics       # read repository
└── common           # security, error, idempotency, time
```

각 feature 내부는 다음 경계를 사용한다.

```text
api             Controller, request/response DTO
application     command/query use case, transaction boundary
domain          aggregate, value, policy, repository port
infrastructure  JPA entity/repository, external adapter
```

`transaction`은 카드 구매 확장까지만 알고, `settlement`가 명세와 스케줄을 관리한다. settlement가 transaction application port를 호출하게 해 순환 의존을 피한다.

## 3. 자산 다형성

영속 aggregate는 `Asset` 하나다.

```text
Asset
- bookId
- assetTypeId
- ownershipScope / ownerMemberId
- name
- openedOn
- memo
- archivedAt
- version

CardSetting
- cardAssetId
- closingDay / paymentDay / paymentMonthOffset
- settlementAssetId
- autoSettlementEnabled

DebitCardSetting
- debitCardAssetId / paymentAssetId

SavingsSetting
- savingsAssetId / transferAssetId / transferDay
```

실제 행동 차이가 생기는 지점만 다형화한다.

```java
public sealed interface AssetBehavior
        permits StandardAssetBehavior, CreditCardBehavior,
                DebitCardBehavior, SavingsBehavior {
    AssetBehaviorType type();
}
```

정책 수가 고정된 작은 집합이면 `EnumMap<AssetBehaviorType, AssetBehavior>`가 적합하다. 현재 신용카드·체크카드·적금의 설정 차이는 1:1 composition으로 두고, posting처럼 실제 행동 차이가 있는 지점만 Strategy/Policy로 승격한다.

자산 종류는 고정 시스템 코드만 사용하고 표시 이름은 behavior를 결정하지 않는다. `BANK`는 하위 계약과 DB 코드를 유지하되 사용자에게는 `계좌`로 표시한다. 마이너스 통장은 별도 코드나 Strategy가 아니라 음수 잔액을 가진 `BANK` 자산이므로 결제 계좌와 일반 이체 후보에서도 다른 계좌와 동일하게 다룬다. `OTHER`는 `CASH`와 동일한 `STANDARD` 정책을 사용하며 개별 용도는 자산 이름으로 표현한다. 사용자 정의 종류 생성 분기와 관련 DTO는 두지 않는다.

`MembershipService.createLedgerBook`의 단일 트랜잭션은 생성자 멤버를 flush한 뒤 자산 유형을 bootstrap하고, 전용 `DefaultAssetBootstrapService`로 현금·계좌·신용카드·체크카드와 연결 설정을 생성한다. 공개 자산 생성 API를 네 번 재사용해 idempotency claim·가계부 lock·조회를 중복하지 않는다. 중간 설정 FK가 실패하면 가계부·멤버·유형·자산·분류를 모두 rollback한다. 0원 기본 자산은 `OPENING_BALANCE`를 생성하지 않는다.

`MembershipService.deleteCurrentLedgerBook`은 현재 멤버십으로 book ID를 찾고 요청의 `expectedLedgerId`와 먼저 비교한 뒤 `ledger_book`을 pessimistic write lock으로 읽어 `expectedVersion`을 비교한다. 이 ID 조건은 이전 가계부 삭제와 새 가계부 생성 사이 ABA를 막는다. 멤버 참여와 초대 발급·취소는 같은 book lock 순서를 사용하고 `ledger_book.updated_at`을 touch해 version을 증가시키므로, 공유 구조가 바뀐 뒤 예전 삭제 snapshot은 `412`로 거부된다. 일치할 때 부모 entity 하나를 삭제해 DB cascade를 사용하며 application service가 하위 repository를 순서대로 지우지 않는다. 확인 문구 `가계부 삭제`는 HTTP 경계에서 검증한다. 사용자와 Spring Session은 삭제하지 않으므로 성공 응답 뒤 같은 세션으로 즉시 가계부 없음 상태를 조회할 수 있다.

초대 발급은 `DirectInvitationCodeGenerator`가 `SecureRandom`으로 숫자 6자리를 만들고 `SecretTokenService`가 URL용 고강도 token과 두 digest를 만든다. repository의 단일 native insert가 DB unique 충돌이면 0을 반환하고 application service가 새 값으로 제한 재시도하므로 중복 사전 조회 경쟁을 만들지 않는다. 입력이 정확히 6자리면 `direct_code_digest`, 긴 URL token이면 `link_token_digest`로 조회한다. 짧은 코드의 열거 공격은 단일 Mac mini 인스턴스에서 로그인 사용자별 10분 20회 in-memory window로 제한하고, 다중 인스턴스로 확장할 때 Redis 같은 공유 limiter로 교체한다.

자산 목록 query model은 영속 entity를 화면 그룹 DTO로 바꾸지 않는다. `AssetView`가 고정 종류의 `systemCode`, `ACTIVE/ARCHIVED` 상태, signed `currentBalanceWon`, `currentMonthCardPaymentDueWon`, `nextMonthCardPaymentDueWon`을 함께 반환한다. 기본 `GET /api/assets`는 활성 자산만, `status=ARCHIVED/ALL`은 보관 또는 전체를 반환한다. 프론트는 전체 결과로 순자산을 계산하되 활성 결과만 자금·카드·투자·대출·보험 그룹과 신규 선택기에 사용한다. 기준 월은 주입된 `Clock`을 `Asia/Seoul`로 해석하며, 카드 결제 금액은 목록에 포함된 카드 ID를 대상으로 현재 월 시작부터 다다음 월 시작 전까지 `card_statement_forecast.payment_amount_won`을 한 번의 조건부 집계 query로 현재·다음 달에 나눈다. 비카드와 해당 월 명세가 없는 카드는 0을 반환하며, 자산별 추가 조회나 별도 집계 cache를 만들지 않는다.

## 4. 거래 다형성

API command를 sealed hierarchy로 분리하면 사용하지 않는 nullable 필드가 가득한 하나의 요청 DTO를 피할 수 있다.

```java
public sealed interface CreateTransactionCommand
        permits CreateIncome, CreateExpense, CreateTransfer {}

public record CreateExpense(
        long amountWon,
        UUID assetId,
        UUID categoryId,
        UUID performedByMemberId,
        LocalDate occurredOn,
        String description
) implements CreateTransactionCommand {}
```

`performedByMemberId`는 로그인 사용자가 아니라 경제활동 주체다. 요청 기본값은 현재 멤버지만 같은 가계부의 다른 멤버 한 명을 선택할 수 있다. `createdByMemberId`는 요청에서 받지 않고 인증 세션에서 기록하며 공동·분할 performer 타입은 만들지 않는다.

`TransactionFactory`가 command를 `LedgerTransaction + List<TransactionPosting>`으로 변환한다.

- 수입: `+amount`
- 지출: `-amount`
- 이체: `-amount`, `+amount`
- 카드 구매: 지출 policy + `CardCharge`
- 체크카드 구매: 선택 자산은 체크카드로 보존하고 연결 결제 계좌에 `-amount`
- 카드 정산: 이체 policy + `CARD_SETTLEMENT`

공개 일반 이체 command는 출발·도착 자산을 같은 가계부 범위에서 읽기 잠금으로 확인한 뒤 두 자산의 고정 유형 `systemCode`가 각각 `BANK` 또는 `SAVINGS`인지 검증한다. 소유 marker는 권한 검사에 사용하지 않으므로 현재 사용자, 다른 구성원, 공동 소유 계좌·적금 사이의 모든 조합을 허용한다. 아니면 `400 TRANSFER_ACCOUNT_OR_SAVINGS_REQUIRED`로 전체 요청을 거부한다. 계좌→적금 납입과 적금→계좌 인출도 같은 일반 이체 posting policy를 사용하며 통계에서 제외한다. 카드 정산·선결제는 일반 이체 command를 우회하는 전용 use case이므로 이 제한을 공유하지 않고 각 결제 정책이 계좌와 카드 posting을 만든다.

자산 생성·수정의 `openingBalanceWon`과 `openedOn`은 호환 필드명이며 각각 기준일 잔액과 잔액 기준일을 뜻한다. application service는 선언값을 `asset.balance_anchor_won`에 함께 저장하고 기존 내부 `OPENING_BALANCE` 업무 이력도 동기화한다. 현재 잔액 read model은 기준일 잔액에 기준일 당일 이후 유효 posting만 합산하며 기준일 이전 거래는 통계·원장 이력에만 반영한다. 신용카드 구매 생성·정정은 구매일과 카드 잔액 기준일을 비교해 charge의 `absorbed_by_balance_anchor`를 결정하고, 자산 기준일 수정은 기존 구매 charge를 같은 DB 트랜잭션에서 다시 분류한 뒤 명세와 schedule을 재계산한다.

모든 자산 생성은 사용자가 선택한 잔액 기준일과 기준일 잔액을 받는다. 신용카드는 카드 설정, 체크카드는 결제 계좌를 유형별 command와 composition entity로 저장한다. 적금 자동이체는 선택 command이며, command가 없으면 설정 entity를 만들지 않고 command가 있으면 계좌·일을 함께 저장한다. 기존 설정이 있는 적금 수정에서 command를 제거하면 설정 entity도 제거한다. 적금 설정만으로 자동 거래를 만들지 않는다.

부호 계산과 posting 생성 규칙을 Controller나 여러 Service에 흩어 놓지 않는다.

```java
public interface TransactionPostingPolicy<C extends CreateTransactionCommand> {
    TransactionDraft create(C command, TransactionContext context);
}
```

정책 lookup은 `EnumMap<TransactionType, TransactionPostingPolicy<?>>`, 거래 안의 자산 중복 확인은 `HashSet<UUID>`, posting은 작은 불변 `List`를 사용한다. 거대한 양방향 `@ManyToMany` 컬렉션은 만들지 않는다.

## 5. 카테고리 추상화

식비·교통비·의료비는 현재 행동 차이가 없는 데이터다. `FoodCategory`, `TransportCategory` 같은 클래스 상속은 만들지 않는다.

```text
Category
- kind: INCOME | EXPENSE
- systemCode
- isFallback
- name
- archivedAt
```

행동 차이가 생기는 fallback 삭제 정책만 `CategoryArchivePolicy`로 분리한다. 시스템 fallback은 삭제 거부, 일반 카테고리는 같은 방향 fallback으로 거래를 재배치한다.

## 6. 카드 정책

카드 구매 전체 transaction과 명세 회차·실제 결제를 분리한다.

```text
CardCharge
- sourceTransactionId
- statementId
- origin: PURCHASE | OPENING_BALANCE
- installmentNo / installmentCount
- principalAmountWon
- expectedSettlementOn

CardStatementPayment
- statementId
- type: PREPAYMENT | REGULAR
- amountWon / paidOn
- settlementTransactionId
- createdByMemberId
```

한 구매의 charge 원금 합계는 구매 금액과 같고, 하나의 명세에는 선결제가 여러 건일 수 있지만 정규 결제는 최대 한 건이다. 명세 잔액 초과 검사는 statement 행 잠금 안에서 수행한다.

날짜 계산은 순수 함수인 `CardBillingCyclePolicy`가 맡는다.

```java
ExpectedStatement calculate(
    LocalDate purchaseDate,
    int closingDay,
    int paymentDay,
    int paymentMonthOffset
);
```

29~31일이 없는 달은 해당 월 말일로 보정하고 `KoreanBusinessCalendar`가 주말과 공식 공휴일이면 다음 한국 영업일까지 순연한다. 계산된 `expectedSettlementOn`은 charge에 저장해 카드 설정이나 휴일 데이터 변경이 과거 구매를 바꾸지 않게 한다.

명세 상태 전이는 aggregate method로 제한한다.

```text
OPEN -> FINALIZED -> PAID
  └---------> CANCELLED
```

- OPEN: 구매 수정 시 예상액 재계산 가능
- FINALIZED: 직접 수정 대신 차액 조정 정책 필요
- PAID: 감액·삭제 시 원 결제 계좌 환불과 charge·명세·정산을 함께 재조정

카드 구매의 `CorrectCardPurchaseUseCase`와 `RefundCardPurchaseUseCase`를 분리한다. 기록 정정은 원 결제일 기준으로 원거래·charge·명세·정산을 소급 교정한다. 실제 환불은 구매·결제 이력을 보존하고 환불일 통계를 상쇄하며, 미결제분은 카드 부채를 줄이고 결제 완료분은 영향받는 statement를 정해진 순서로 잠근 뒤 최신 결제부터 실제 원 결제 계좌로 반환한다. 두 유스케이스 모두 구매, charge, 명세, 정산과 posting을 한 트랜잭션에서 일치시킨다. 카드 일시불·할부를 지원하되 이자는 계산하지 않는다. 구매 transaction 하나를 회차별 immutable `CardCharge` 목록으로 분해하고 원금 합계가 구매 금액과 일치하는지는 application policy가 검증한다.

두 command는 같은 입력으로 preview를 먼저 생성하고 apply에 `expectedVersion`, preview token, idempotency key를 보낸다. apply는 구매→charge→statement→payment의 고정 순서로 잠그고 preview 이후 상태가 바뀌었으면 `412 CARD_PURCHASE_PREVIEW_STALE`로 저장 전체를 거부한다. 환불 배분은 영향받는 명세의 미결제분을 먼저 줄이고, 환불 후 유효 청구액을 초과하는 결제액만 `paid_on desc, id desc`의 실제 계좌로 반환한다. 같은 명세의 다른 구매 금액을 특정 구매의 결제액으로 임의 귀속시키지 않는다.

`PrepayCardStatementUseCase`와 scheduler의 `SettleCardStatementUseCase`는 같은 statement payment domain service를 사용한다. 둘 다 statement를 잠그고 남은 금액을 다시 계산하며, 선결제는 요청 금액만큼 여러 번, 정규 결제는 남은 전액을 한 번 기록한다. 시간 테스트를 위해 `Clock`을 주입한다.

선결제는 서버 preview 뒤 apply한다. preview token은 statement version, 남은 금액, 서버가 정한 `Asia/Seoul` 적용일, 요청 금액과 현재 설정 결제 계좌 ID를 묶으며 apply가 statement를 잠근 뒤 다시 계산한 값과 다르면 `412 CARD_STATEMENT_PREVIEW_STALE`로 전체 거부한다. 결제 계좌의 파생 잔액은 다른 정상 거래와 공존하므로 stale 기준으로 직렬화하지 않고 apply 시 최신 잔액을 authoritative 응답으로 돌려준다. 전액 선결제는 즉시 `PAID`로 마감하되 같은 명세의 구매 정정으로 미결제액이 다시 생기면 결제일 전은 `OPEN`, 결제일 이후는 `FINALIZED`로 재개한다.

카드 설정의 자동 정산을 켜면 기존 `OPEN`·`FINALIZED` 미결제 명세 schedule을 upsert하고, 끄면 처리 전 schedule을 `CANCELLED`로 바꾼다. 결제 계좌를 바꾸면 처리 전 schedule만 새 계좌로 갱신하고 기존 payment의 실제 출금 계좌는 보존한다. worker는 `scheduled_on <= 오늘`인 schedule을 작은 트랜잭션으로 따라잡고 장부 거래일과 `paid_on`에는 원래 `scheduled_on`을 사용한다. 기술 실패만 지수 backoff로 `FAILED` 재시도하며, 테스트에서는 scheduling infrastructure를 끄고 service/worker 진입점을 직접 실행한다.

카드 정산과 선결제는 경제활동 주체가 없는 통계 제외 자산 이동이다. `settlementAssetId`가 실제 자금 출처이며 자동 정산 사용 여부와 무관하게 카드 생성·수정에서 필수다. 선결제를 실행한 사용자는 `createdByMemberId`로만 남긴다. 결제 계좌의 장부 잔액이 부족해도 남은 전액을 posting하고 음수 잔액을 허용한다. 잔액 부족은 실패가 아니며 기술 오류만 worker 재시도 대상으로 둔다.

## 7. 카테고리 삭제 유스케이스

`ArchiveCategoryUseCase`의 트랜잭션 경계:

1. 대상과 fallback 조회/잠금
2. native bulk update로 거래를 fallback에 재배치
3. persistence context clear
4. 대상 archive
5. audit

audit에는 영향 건수와 날짜 범위를 한 건으로 남긴다. command를 실행한 프론트는 거래 목록·달력·통계 query를 invalidate한다.

분류 생성·이름 변경은 같은 거래 방향에서 대소문자 무시 이름 중복을 막고, 응답에 `version`과 연결 거래 수를 포함한다. 거래 생성·수정은 분류를 read lock으로 확인하고 분류 삭제는 write lock으로 이동·archive하여, 삭제가 끝난 분류를 새 거래가 다시 참조하는 경쟁 상태를 만들지 않는다.

일반 거래 수정·삭제는 `UpdateGeneralTransactionUseCase`와 `DeleteGeneralTransactionUseCase` 경계에서 처리한다. 원 거래 행을 잠그고 `expectedVersion`이 다르면 `412`로 전체 저장을 거부한다. 수정은 유형을 불변으로 유지하면서 posting을 한 트랜잭션에서 재구성하고, 삭제는 거래만 soft delete해 감사 가능한 posting 원본을 보존한다. 아직 card charge가 없는 일반 지출이 결제 자산을 신용카드로 바꾸면 같은 update 트랜잭션에서 기존 posting을 교체하고 billing snapshot·회차별 charge·명세·schedule을 생성해 `CARD_PURCHASE` aggregate로 승격한다. 이미 card charge가 있는 신용카드 구매와 시스템 거래는 `managementType`으로 구분해 일반 command에서 차단한다.

사용자 수입·지출 command는 `excludedFromStatistics`를 함께 받고 응답에도 반환한다. 이 값은 posting 생성과 자산 잔액 계산에 관여하지 않고 `ledger_financial_activity` 포함 여부만 제어한다. 신용카드 구매 정정과 환불 preview/apply command도 같은 값을 preview token·idempotency hash에 포함해 확인 뒤 다른 집계 상태가 저장되는 것을 막는다. 이전 클라이언트가 필드를 생략하면 `false`로 처리하고 일반 이체에는 `true`를 허용하지 않는다.

## 8. 자산 삭제·보관 유스케이스

`PreviewAssetRemovalUseCase`는 OpenAPI 0.8의 `GET /api/assets/{assetId}/removal-preview`에서 다음 authoritative 결과를 한 번에 반환한다.

- soft delete를 포함해 posting 또는 `primary_asset_id`로 대상 자산을 참조한 distinct 거래 수
- 이력 0건이면 `DELETE`, 1건 이상이면 `ARCHIVE`
- signed 현재 잔액과 대상 카드의 미결제 명세 수
- 대상 자산을 출금원으로 참조하는 신용카드·체크카드·적금 설정과 미처리 카드 결제 schedule
- 자산 `expectedVersion`과 위 이력·잔액·연결 상태를 묶은 `previewToken`

차단 조건은 `blockingLinks`로 반환하는 활성 자산의 필수 출금원 연결과 그 자산을 자금 출처로 쓰는 미처리 schedule뿐이다. 이미 보관된 자산의 비활성 설정 참조는 차단하지 않되 자동 해제하지도 않고, 대상의 disposition을 `ARCHIVE`로 올려 참조를 보존한다. 현재 잔액과 대상 카드의 미결제 명세는 경고 정보이며 0으로 만들거나 선결제하도록 강제하지 않는다. 보관된 신용카드의 기존 명세·schedule은 계속 정산하며 카드 자신이 정산 대상이라는 이유로 archive를 막지 않는다.

`RemoveAssetUseCase`는 `DELETE /api/assets/{assetId}?expectedVersion&previewToken`에서 대상 자산을 잠그고 preview 입력을 다시 계산한다. version이나 disposition·이력·잔액·차단 연결 상태가 달라졌으면 `412`로 아무것도 적용하지 않고 새 미리보기 확인을 요구한다. blocking link가 있으면 `409`로 거부한다. 유효하면 이력 없는 자산과 그 자체의 1:1 설정을 물리 삭제하고, 이력이 있으면 `archived_at/archived_by_member_id`를 기록한 뒤 `DELETED/ARCHIVED` authoritative 결과를 반환한다.

보관 자산은 활성 50개와 신규 거래·출금원 선택에서 제외하지만, posting·`primary_asset_id`·명세·결제는 그대로 유지해 순자산·과거 거래·통계·자동 정산에 계속 참여한다. `GET /api/assets?status=ARCHIVED`와 보관 상세 조회는 허용하되 update command는 거부하고 MVP에는 restore command를 두지 않는다. 작성 세션은 active/archived/all 목록과 해당 detail을 갱신·제거하고 자산 현황을 다시 계산하며, 다른 세션은 기존 route 진입·focus·수동 새로고침 경계를 따른다.

## 9. 검증 수준

필수 검증:

- 인증된 활성 가계부 멤버
- 같은 가계부의 멤버·자산·분류
- 원화 금액 양수
- 이체 출발/도착 다름
- archive 자원 신규 사용 금지
- 명세·정산 중복 금지
- finalized/paid 구매 변경 정책

중복하지 않을 검증:

- API에서 확인한 unique를 서비스가 여러 번 재확인
- 단일 writer 환경에서 posting 합계를 DB trigger로 다시 계산
- 자산 표시명으로 behavior 추론
- 사용자 경고 수준의 조건을 서버 오류로 처리

unique 충돌은 DB를 최종 진실로 두고 안정된 409 오류 코드로 변환한다.

모든 활성 멤버는 같은 권한으로 모든 자산·카테고리·거래·카드 설정을 CRUD한다. 소유자 marker나 가계부 생성자는 권한 분기에 사용하지 않는다. 사용자 등록·수정 알림은 만들지 않는다.

한 가계부에는 활성 자산을 최대 50개까지 만든다. 생성 use case는 가계부 행을 잠근 뒤 활성 자산 수를 확인해 동시 요청에서도 하나만 50번째를 차지하게 하고, 초과 요청은 `ASSET_LIMIT_EXCEEDED`로 거부한다.

## 10. 동시 수정과 조회 갱신

수정 조회 응답에는 aggregate `version`을 포함하고 update command는 `If-Match` 또는 `expectedVersion`으로 편집 시작 시 version을 전달한다. 현재 version과 다르면 `412 VERSION_CONFLICT`를 반환하고 어떤 필드도 저장하지 않는다. 서버는 필드 자동 병합을 하지 않으며 응답에 최신 resource를 다시 읽을 수 있는 안정된 식별자를 제공한다.

MVP에는 SSE와 sync outbox를 두지 않는다. REST command 결과가 authoritative하며 작성 세션은 해당 응답으로 TanStack Query cache를 갱신하거나 관련 query를 invalidate한다. 다른 세션은 route 진입, window focus, 사용자 새로고침에서 재조회한다. 목록은 cursor pagination, 달력·통계는 기간이 제한된 projection query를 사용한다. `GET /api/assets/{assetId}/transactions`는 같은 가계부의 활성·보관 자산을 먼저 확인한 뒤 직접 선택한 거래와 posting 거래를 합친 최신순 cursor page를 반환한다. 홈 달력과 거래 목록은 선택적 `performedByMemberId`를 같은 가계부 구성원으로 검증한 뒤 동일하게 적용하고, 생략한 이전 클라이언트에는 전체 기록을 반환한다. 프론트 query key에는 월·기간·선택 구성원 또는 자산 ID를 함께 넣어 서로 다른 범위의 응답을 공유하지 않는다.

월간 통계는 별도 `statistics` feature의 read-only controller/application/repository로 둔다. transaction feature의 persistence 구현에 의존하지 않고 DB의 canonical `ledger_financial_activity` view와 공개된 월간 HTTP 계약만 공유한다. view가 사용자 선택 집계 제외를 먼저 제거하므로 달력·월 합계·분류·연간 흐름이 같은 의미를 유지하며, 원장 목록은 base transaction을 조회해 제외 기록도 반환한다. `YearMonth`에서 한 달 반개구간을 서버가 만들고 동적 WHERE로 선택 필터만 SQL에 포함해 nullable `OR` 조건의 generic plan을 피한다. 모든 필터 ID와 자산 소유 조합은 같은 가계부 경계에서 검증하며, 조회에는 version·행 잠금·idempotency를 적용하지 않는다. 응답은 DB 집계 금액을 바꾸지 않고 환불로 음수가 된 지출·분류 순금액도 그대로 전달한다.

## 11. JPA 규칙

- 모든 연관관계 기본 `LAZY`
- aggregate 내부에서만 cascade 사용
- 멤버·자산·결제 계좌에는 cascade 금지
- Entity에 Lombok `@Data` 금지
- Entity를 API 응답으로 직접 직렬화하지 않음
- 목록·통계는 projection/전용 SQL로 N+1 방지
- `@Version`으로 lost update 방지
- Flyway만 DDL 변경, Hibernate `ddl-auto=validate`
- `LocalDate` ↔ `date`, `Instant` ↔ `timestamptz`, 원화 ↔ `long`

도메인 경계에서만 작은 value object를 사용할 수 있다.

```java
public record MoneyWon(long value) {
    public MoneyWon {
        if (value <= 0) throw new IllegalArgumentException("amount must be positive");
    }
}
```

모든 JPA 컬럼에 converter를 강제하지 않고 persistence에서는 primitive `long`을 사용해도 된다.

## 12. 인증 세션 유지

로그인은 별도 remember-me token이나 브라우저 저장소의 credential을 만들지 않고 PostgreSQL JDBC Spring Session을 사용한다. `DONDOK_SESSION`에는 추측 불가능한 세션 ID만 담고 운영에서는 `Secure`, 모든 환경에서 `HttpOnly`·`SameSite=Lax`를 적용한다. 쿠키 `Max-Age`와 절대 세션 수명은 90일로 맞춰 브라우저·설치형 PWA 재실행 뒤에도 같은 서버 세션을 복원한다. 서버 세션은 마지막 접근 후 30일이면 먼저 만료하며 `AbsoluteSessionLifetimeFilter`가 생성 후 90일을 넘긴 세션을 무효화한다.

현재 기기 로그아웃은 해당 세션 invalidation과 쿠키 삭제를 함께 수행하고, 전체 기기 로그아웃과 비밀번호 재설정은 principal의 모든 JDBC 세션을 제거한다. 클라이언트는 비밀번호·세션 ID·별도 자동 로그인 token을 `localStorage`, `sessionStorage`, IndexedDB 또는 service worker cache에 저장하지 않는다.

## 13. 로컬 서버와 저장소

- Docker Compose로 Spring/PostgreSQL 실행 환경 고정
- `.env`, 비밀번호, 세션 키, 인증서, 백업 파일은 Git에 포함하지 않음
- Flyway migration은 CI와 실제 PostgreSQL Testcontainers에서 검증
- main 직접 push보다 짧은 feature branch + PR 사용
- GitHub Actions에서 build, test, migration smoke test 실행
- PostgreSQL 정기 백업과 실제 복원 테스트 포함
- 단일 서버에서는 Redis와 별도 실시간 transport 없이 시작

공개 도메인+HTTPS로 운영하므로 reverse proxy만 외부에 노출하고 secure cookie, CSRF, 인증 관련 rate limit, 방화벽과 암호화 백업을 배포 전에 검증한다.
