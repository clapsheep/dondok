# 카드 내역 선택·부분 금액 결제 QC 인수 계획

D-069 이후 현재 진입점은 신용카드 자산 상세의 `내역 선택 결제`와 `부분 금액 결제`다. 아래 기존 명세 API 시나리오는 과거 결제 이력·정정·취소 호환 검증으로 유지한다. B4~B6의 자동 실행·예약 생성 기대값과 이에 대응하는 옛 E2E 흐름은 폐기한다.

## D-069 현재 인수 기준

- 최근 정산일은 서울 오늘 이하의 가장 최근 달력 정산일이며 29~31일이 없는 달은 말일로 보정한다. 정산일 당일을 포함하고 결제일 전후로 체크 범위를 바꾸지 않는다.
- 미결제 구매·할부 회차만 조회하고 기본 선택은 최근 정산일까지 마감된 명세다. 미래 회차는 직접 선택할 수 있다. 이전에 결제한 회차·기준일에 흡수된 구매는 다시 청구하지 않는다.
- cursor로 펼치지 않은 내역도 기본 선택·전체 선택 합계와 결제 대상에 포함한다. 사용자가 해제한 내역은 제외한다.
- 부분 금액은 전체 미결제 이내이며 결제 예정일, 사용일 순으로 배분한다. 결제일이 지나도 허용한다.
- 선택 계좌·실제 결제일·카드 명의자를 기록하고 계좌 음수를 허용한다. 통계에는 원 구매만 반영한다.
- 선택 배분은 구매 정정으로 청구 ID가 재생성돼도 유지한다. 환불은 기존 명세 미결제 감소 우선·실제 계좌 반환 정책을 따른다.
- 두 구성원이 같은 snapshot으로 결제하면 한 요청만 성공하며 다른 요청은 412로 전부 거부한다. 같은 요청 키 재시도는 동일 결과를 반환한다.
- 320/390px·iPad 세로/가로·desktop 회전, 탭 전환과 412 후 계좌·날짜·금액 draft를 보존한다.
- V34는 미처리 자동 예약만 취소하고 완료 결제·posting을 보존한다. 구버전 클라이언트의 auto=true도 false로 정규화하고 worker는 실행하지 않는다.
- 결제 취소 후 내역이 다시 기본 선택되고 완료 뒤 추가된 과거 구매도 미결제로 조회된다.
- 검증 위치: `CardPaymentItemIntegrationTest`, `CardClosingSelectionTest`, `CardPaymentOwnerMigrationIntegrationTest`, `cardItemSelection.test.mjs`, `card-statement-settlement.spec.ts`.

## 현재 API

- `GET /api/assets/{cardAssetId}/card-payment-items`: 미결제 항목 cursor, 최근 정산일, 전체/기본 선택 합계, snapshot token.
- `POST /api/assets/{cardAssetId}/card-payments`: SELECTED/AMOUNT 모드, 기본 선택·예외 항목 또는 금액, 출금 계좌, 실제 결제일과 idempotency key. stale snapshot은 `412 CARD_PAYMENT_SELECTION_STALE`.
- 기존 명세 상세·결제 계좌 정정·취소 API를 이어 사용한다.

## 기존 명세 API 호환 시나리오

## 영향 범위와 source of truth

| 규칙 | 최소 증명 계층 | E2E에서 확인할 연결 결과 |
|---|---|---|
| 명세 남은 금액, 결제 posting, 상태 전이 | PostgreSQL/Spring integration | 상세의 남은 결제·결제 내역과 자산 현황이 같은 값 |
| 한 명세 부분·복수 선결제 | Backend integration + 대표 UI E2E | 같은 상세에서 두 번 결제하고 두 결제 내역과 최종 잔액 확인 |
| 초과 동시 요청 직렬화 | 두 thread Backend integration | 두 브라우저의 오래된 preview/draft 충돌 화면 |
| Idempotency-Key 재시도 | Backend/API integration | UI 중복 클릭 방지와 authoritative 응답 반영 |
| 계좌 잔액 부족에도 전액 posting | Backend integration + 대표 UI E2E | 0원 계좌가 음수가 되고 카드·명세가 전액 감소 |
| 선결제·정규 결제 통계 제외 | SQL/Backend integration + 대표 UI E2E | 월 수입·지출 합계는 원 구매 금액 그대로 |
| due worker, catch-up, 중복 실행 | 고정 Clock Backend integration | 자동 결제 결과를 명세·홈·자산 UI에서 읽는 smoke |
| 자동 정산 toggle·결제 계좌 변경 | Asset/Card Backend integration | 자산 상세 설정 저장 후 pending schedule의 실행 계좌가 일치 |
| 완료 결제의 잘못된 출금 계좌 정정 | Backend integration + 대표 UI E2E | 명세 금액·날짜는 유지되고 기존 계좌 복원·새 계좌 차감·결제 내역 표시가 함께 바뀜 |
| 자동 정산 삭제 | Backend integration + 대표 UI E2E | 결제 계좌·카드 잔액과 미결제 명세를 복원하고 같은 schedule을 다시 실행하지 않음 |
| 반응형 draft·focus·접근성 | Playwright | 390px, iPad, desktop에서 같은 draft와 행동 유지 |

## 확정 API 결속

- 목록: `GET /api/assets/{cardAssetId}/card-statements`는 기본적으로 미결제 명세를 bounded cursor로 반환한다.
- 상세: `GET /api/card-statements/{statementId}`는 남은 금액, signed 결제 계좌 잔액, 자동 정산 schedule과 결제 내역의 authoritative 상태다.
- preview: `POST /api/card-statements/{statementId}/prepayments/preview`에 `amountWon`, `expectedVersion`을 보낸다.
- apply: `POST /api/card-statements/{statementId}/prepayments`에 같은 값과 `previewToken`, `Idempotency-Key`를 보낸다.
- 결제 계좌 정정: `PUT /api/card-statements/{statementId}/payments/{paymentId}`에 `settlementAssetId`, `expectedVersion`을 보내며 금액·결제일은 입력받지 않는다.
- 결제 취소: `DELETE /api/card-statements/{statementId}/payments/{paymentId}?expectedVersion=...`는 선결제와 자동 정산을 같은 원자적 command로 취소한다. 자동 정산 schedule은 `CANCELLED`로 남긴다.
- 적용일은 사용자가 입력하지 않는다. preview의 `appliedOn`을 `Asia/Seoul` 기준 서버 오늘로 읽기 전용 표시하고 apply 결과의 `payment.paidOn`과 일치하는지 검증한다.
- 계좌 잔액은 정상적인 다른 거래와 공존하므로 preview token stale 기준에서 제외한다. apply 응답의 최신 signed 잔액을 authoritative 결과로 사용한다.
- 412에서 보존할 사용자 draft는 선결제 금액 하나다.
- preview의 version 불일치는 `412 VERSION_CONFLICT`, apply의 stale token/version은 `412 CARD_STATEMENT_PREVIEW_STALE`, 남은 금액 초과는 `409 CARD_PREPAYMENT_AMOUNT_EXCEEDED`를 assertion한다.
- worker 테스트를 위해 운영에 노출되지 않는 고정 `Clock` 또는 application service 직접 호출 경계를 사용한다. 브라우저 전용 시간 조작 endpoint는 만들지 않는다.

## Backend 자동화 시나리오

### B1. 같은 명세의 부분·복수 선결제

1. 결제 계좌 100,000원, 카드 명세 120,000원을 만든다.
2. 30,000원 선결제를 적용한다.
3. 같은 명세에 40,000원 선결제를 다시 적용한다.
4. payment는 서로 다른 ID로 2건, 모두 `PREPAYMENT`이고 작성자는 실행 멤버다.
5. 명세는 `paid=70,000`, `remaining=50,000`이며 카드 잔액은 70,000원 감소하고 계좌는 70,000원 감소한다.
6. 두 settlement transaction은 `TRANSFER/CARD_PREPAYMENT`, `performed_by=null`이며 통계 집계에는 나타나지 않는다.

### B2. 초과 동시 요청과 idempotency

- 남은 100,000원에 대해 서로 다른 key로 70,000원과 60,000원을 같은 statement version에서 동시에 실행한다.
- statement row lock 뒤 정확히 하나만 commit되고 다른 요청은 확정된 412/409 `errorCode`로 아무 posting/payment도 만들지 않는다.
- 같은 key·같은 payload를 동시에 또는 순차 재시도하면 같은 payment/transaction ID를 반환하고 행은 각각 1건이다.
- 같은 key를 다른 amount에 재사용하면 `IDEMPOTENCY_KEY_REUSED`이며 기존 결과는 바뀌지 않는다.

### B3. 잔액 부족과 통계 제외

- 0원 계좌에서 80,000원을 선결제하면 계좌 `-80,000원`, 카드 부채와 명세 remaining은 각각 80,000원 감소한다.
- 계좌 잔액 부족 상태, retry 상태, 부분 성공 상태를 만들지 않는다.
- 구매일 지출 120,000원은 선결제 전후 동일하고 수입은 0원이다.

### B4. due worker remaining 전액

- 120,000원 명세에 선결제 30,000원과 40,000원을 적용한 뒤 due worker가 남은 50,000원만 `REGULAR`로 결제한다.
- regular payment와 settlement transaction은 각각 1건이며 작성자와 거래 주체는 null이다.
- 명세는 `PAID`, remaining 0, schedule은 `COMPLETED`가 된다.
- 이미 remaining 0인 명세는 worker가 실행돼도 새 payment/posting을 만들지 않고 schedule만 일관된 완료 상태로 둔다.

### B5. catch-up·중복 worker

- 서버가 중단된 동안 due date가 지난 `SCHEDULED` 명세를 현재 `Clock`으로 한 번 처리한다.
- 같은 worker를 연속 실행하거나 두 worker가 동시에 같은 schedule을 가져가도 regular payment unique와 schedule lock으로 한 건만 생성된다.
- 처리 완료 뒤 애플리케이션 context를 다시 시작해도 새 payment나 settlement transaction이 생기지 않는다.
- 한 schedule 실패가 다른 due schedule의 처리를 롤백하지 않으며, 실패 상태·재시도 시각 계약을 별도 assertion한다.

### B6. 자동 정산 toggle과 결제 계좌 변경

- 자동 정산 `false → true`는 아직 결제되지 않은 명세의 실행 가능한 schedule을 due date와 현재 결제 계좌로 준비한다.
- `true → false` 뒤 worker는 해당 unpaid 명세를 자동 결제하지 않는다.
- 자동 정산이 켜진 카드의 결제 계좌를 A에서 B로 바꾸면 아직 실행되지 않은 schedule은 B를 사용한다.
- 이미 성공한 payment의 `settlement_asset_id`와 과거 posting은 A로 보존한다.
- 보관 또는 다른 가계부 계좌로 변경하려는 기존 Asset 검증은 유지한다.

### B7. 완료된 선결제·자동 정산의 출금 계좌 정정

- 선결제의 출금 계좌를 A에서 B로 바꾸면 payment와 시스템 이체의 음수 posting만 B로 옮기고 금액·결제일·명세 remaining·카드 posting·통계는 유지한다.
- 완료된 자동 정산이면 완료 schedule의 실행 계좌도 B로 맞추며 미완료 schedule이나 카드의 향후 기본 결제 계좌 설정은 바꾸지 않는다.
- A 잔액은 결제액만큼 복원되고 B 잔액은 같은 금액만큼 감소한다. 잔액 부족도 허용한다.
- 같은 명세 version의 동시 정정만 성공하고 stale 요청은 `412`다. 다른 가계부·보관·결제 불가 자산은 거부한다.
- 해당 결제를 기반으로 환불 반환 posting이 존재하면 부분 정정을 만들지 않고 `409 CARD_PAYMENT_ACCOUNT_CORRECTION_REFUND_EXISTS`로 거부한다.

### B8. 자동 정산 삭제

- 완료된 `REGULAR` payment를 취소하면 payment와 연결 거래를 감사 이력으로 남겨 soft delete하고 결제 계좌와 카드 posting을 함께 되돌린다.
- 명세는 결제일 전이면 `OPEN`, 결제일 이후면 `FINALIZED`로 돌아가고 남은 결제는 취소 금액만큼 복원된다.
- 해당 schedule은 `CANCELLED`로 남으며 worker를 다시 실행해도 새 정규 결제와 posting을 만들지 않는다.
- 환불 반환이 연결됐거나 명세 version이 stale이면 전체 취소를 거부한다.

## Playwright 실제 사용자 흐름

### E1. 두 번의 부분 선결제와 음수 계좌

1. 고유 사용자로 가입하고 가계부를 생성한다. 기본 계좌는 0원, 기본 신용카드를 사용한다.
2. 이번 명세에 포함되는 120,000원 카드 구매를 UI로 기록한다.
3. 카드 자산 또는 카드 구매 상세에서 명세 목록으로 들어가 해당 명세 상세를 연다.
4. `선결제 금액 30,000원`을 입력하고 영향을 확인한다.
5. preview에서 명세 `120,000 → 90,000`, 계좌 `0 → -30,000`, `통계 변화 없음`을 확인하고 적용한다.
   적용일은 서버가 반환한 `appliedOn`을 읽기 전용으로 표시한다.
6. 같은 명세에서 40,000원을 다시 preview/apply한다.
7. 결제 내역 2건, 남은 결제 50,000원, 계좌 -70,000원, 카드 결제 예정 50,000원을 확인한다.
8. 홈 일별 목록에는 두 `카드 선결제` 이체가 보이되 월 합계는 원 구매 지출 120,000원 그대로인지 확인한다.

### E2. stale preview와 draft 보존

1. 독립 browser context 두 개가 같은 명세 version을 연다.
2. B는 60,000원 draft를 입력해 preview한다.
3. A가 먼저 70,000원을 결제한다.
4. B apply는 412/확정 오류로 거부되고 60,000원 draft를 보존한다.
5. 최신 남은 금액과 내 입력을 함께 보여주고, 최신값으로 다시 계산하거나 금액을 고칠 수 있다.
6. 다른 세션의 payment는 route 재진입·focus·수동 새로고침에서 조회된다.

### E3. 반응형·접근성

- 선결제 금액에 focus한 상태로 `390×844 → 768×1024 → 1024×768 → 1280×900`을 순서대로 적용한다.
- amount draft, focus, preview 여부, 명세 ID와 TanStack Query 상태가 유지된다.
- 전체 페이지 가로 overflow가 없고 `결제 영향 확인`, `선결제 기록`, 충돌 재계산 행동은 44×44px 이상이다.
- 320px은 레이아웃 smoke로 별도 확인하되 핵심 필수 범위는 390px·iPad·desktop이다.
- loading 중 입력과 action이 중복 실행되지 않고, offline·404·412에서도 draft를 보존한다.

### E4. 완료된 선결제의 출금 계좌 변경

1. 결제 계좌 A와 B, 카드 구매와 완료된 선결제를 준비한다.
2. 결제 기록의 `출금 계좌 변경`을 열고 공통 자산 선택기로 B를 고른다.
3. 저장 응답 뒤 결제 기록에는 B가 보이고, 명세 금액·결제일·남은 결제는 그대로인지 확인한다.
4. 자산 재조회에서 A는 복원되고 B가 결제액만큼 감소했는지 확인한다.

### E5. 자동 정산 거래 삭제

1. 과거 결제일의 자동 정산 명세를 준비하고 worker가 만든 거래 상세를 연다.
2. `자동 정산 삭제` 확인에서 결제 계좌·카드 잔액 복원과 재정산 중단 결과를 확인한다.
3. 삭제 뒤 계좌는 출금 전 잔액, 카드는 미결제 부채 잔액으로 돌아가는지 확인한다.
4. worker 주기를 한 번 더 지나도 같은 명세의 정규 결제가 다시 생기지 않는지 확인한다.

## Playwright spec 구조

확정된 API와 화면 role/label을 사용해 아래 실행 테스트를 둔다.

1. `자동 정산 거래를 삭제하면 계좌와 카드 잔액을 복원하고 다시 정산하지 않는다`
2. `같은 카드 명세에 두 번 부분 선결제하고 음수 계좌·남은 결제·통계 제외를 확인한다`
3. `완료된 선결제의 출금 계좌를 바꾸면 명세는 유지하고 두 계좌 잔액만 바로잡는다`
4. `두 세션의 오래된 선결제 preview는 거부되고 draft를 최신 명세에 다시 계산한다`

worker concurrency·재기동·idempotency·0원 remaining은 브라우저에 중복 구현하지 않고 Backend integration 결과를 source of truth로 사용한다.

## 실패 증거와 실행

- spec의 `beforeEach`에서 ASCII `X-E2E-Run-Id`, `X-E2E-Test-Id`를 설정한다.
- API network artifact에는 method, query를 제거한 path, status, `X-Request-Id`만 저장한다.
- console과 page error를 별도 JSON으로 붙이고 cookie, CSRF, idempotency key, 거래 메모는 저장하지 않는다.
- Playwright 기본 `trace: retain-on-failure`, screenshot/video 보존 설정을 사용한다.
- seed manifest에는 합성 사용자 식별자, card/account/statement ID, 고정 Clock, migration version만 기록한다.
- 실패 보고에는 최초 단절 지점과 단일 재현 명령을 포함한다.

```bash
cd /absolute/repository/dondok/e2e
npx playwright test tests/card-statement-settlement.spec.ts --project=desktop-chrome
```

### 수동 전액 결제와 미결제 섹션

- 결제일 기본값은 서울 기준 오늘이며 과거 출금일을 선택하면 결제 이력·계좌 원장·달력 모두 해당 날짜로 기록된다.
- 회전과 충돌 후 최신 내용 확인에도 선택 날짜를 보존하고 같은 요청 재시도는 중복 출금을 만들지 않는다.

- 자동 정산을 끈 카드에 과거 구매를 기록하고, 자산 거래 내역 위 미결제 섹션에서 과거 결제일·남은 금액과 결제 버튼을 확인한다.
- 확인 dialog의 전액 결제 기록으로 오늘 날짜 MANUAL 결제와 이체가 생기며 미결제 섹션에서는 사라진다. 잔액과 달력 카드결제는 갱신하되 수입·지출에는 더하지 않는다.
- 거래 상세에서 수동 결제를 취소하면 잔액과 미결제 섹션이 복원된다.
- 독립 두 세션이 같은 잔액을 확인한 뒤 한쪽이 결제하면 다른 쪽은 412를 받고 최신 내용 확인 전까지 재실행할 수 없다.
- 자동 정산과 경합해도 두 번 출금하지 않으며, 결제일 전 부분 선결제는 기존 흐름을 유지한다.

## 결제 후 과거 사용 추가

- 결제일이 지난 명세를 100,000원 전액 결제한 뒤 같은 청구 기간에 20,000원을 추가하면 미결제 섹션과 명세 상세에 안내와 잔액 20,000원을 표시한다.
- 기존 출금 100,000원과 결제 이력은 유지한다. 자동 정산을 켜도 차액을 자동 출금하지 않는다.
- 추가분을 직접 결제하면 20,000원 별도 결제 이력이 남고 미결제 섹션에서 사라진다.
- 결제일 전 전액 선결제 뒤 추가 사용·증액은 기존 자동 예약을 유지한다.
