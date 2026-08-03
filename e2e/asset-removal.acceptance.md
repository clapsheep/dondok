# 자산 삭제·보관 인수 계약

## 1. 범위와 원본 계약

이 문서는 `docs/project-context.md`의 D-007·D-034·D-036, `docs/api/openapi.yaml` 0.8, `docs/architecture/backend-design.md` §8, `docs/architecture/database-design.md`, `docs/design/ux-guidelines.md`의 자산 정리 계약을 Playwright 인수 조건으로 연결한다.

| 영향 경계 | 인수 계약 |
|---|---|
| DB | 이력과 보존해야 할 비활성 설정 참조가 모두 없는 자산은 1:1 설정까지 물리 삭제한다. 이력 또는 보존 참조가 하나라도 있으면 `archived_at`을 기록하고 posting·거래·설정 참조는 유지한다. |
| API | `GET /api/assets/{id}/removal-preview`가 결과·경고·blocker·`expectedVersion`·`previewToken`을 반환한다. `DELETE /api/assets/{id}`는 같은 version/token만 수락한다. |
| Backend | 잔액·거래 이력·필수 결제 계좌 연결·미처리 schedule을 행 잠금 뒤 다시 계산한다. preview가 달라지면 `412`, blocker가 있으면 `409`이며 부분 반영은 없다. |
| Frontend/cache | 성공 뒤 active·archived·all·detail·거래·통계 관련 query를 갱신한다. 보관 자산은 활성 선택기에서 빠지되 순자산과 과거 기록은 남는다. |
| UX | 결과별 dialog, blocker link, 412 재확인, compact 보관 목록과 읽기 전용 상세를 모바일·iPad·desktop에서 같은 의미로 제공한다. |
| QC 증거 | 실제 API/UI, 독립 browser context, seed manifest, console/page error, API status와 request ID, 412 ProblemDetail의 `errorCode`·`correlationId`를 남긴다. |

## 2. authoritative 판정

- `historyTransactionCount`는 유효·soft-delete 거래 모두에서 posting 또는 `primary_asset_id`가 자산을 가리키는 distinct 거래 수다.
- 이력과 보존해야 할 비활성 설정 참조가 모두 없으면 `DELETE`, 둘 중 하나라도 있으면 `ARCHIVE`다. 최초 금액의 `OPENING_BALANCE`도 이력이다.
- 잔액이 0이 아니거나 비활성·보관 설정이 계속 참조한다는 이유를 무시하고 hard delete하지 않는다. 비활성 설정 참조의 archive 승격 경계는 backend integration test에서 검증하고 Playwright에서 조합을 반복하지 않는다.
- blocker는 활성 `CREDIT_CARD_SETTLEMENT`, `DEBIT_CARD_PAYMENT`, `SAVINGS_TRANSFER` 설정과 처리 중인 `CARD_PAYMENT_SCHEDULE`만이다. 비활성 설정 참조는 자동 unlink나 `409` 대상이 아니다.
- 현재 잔액과 미결제 카드 명세는 warning이며 정리를 막지 않는다.
- preview 이후 asset version, disposition, 이력 수, signed 잔액, blocker 또는 schedule 상태가 바뀌면 전체 요청을 `412`로 거부한다.

## 3. Playwright 시나리오

### A. hard delete와 archive 보존

1. 새 가계부에 0원·무이력·무참조 계좌, 최초 금액과 일반 수입 이력을 함께 가진 계좌를 실제 API로 만든다.
2. 무이력 계좌 상세에서 `정리 결과 확인`을 눌러 `완전 삭제`, 이력 0건, 최종 삭제 행동을 확인하고 UI로 실행한다.
3. 성공 후 상세는 `404`이고 active·archived·all 목록 어디에도 ID가 없음을 API로 확인한다.
4. 이력 계좌의 보관 전 순자산과 해당 월 수입 통계를 캡처한다.
5. 상세에서 `보관`, 이력 수, 잔액 warning을 확인하고 UI로 실행한다.
6. 보관 뒤 active 목록과 신규 거래 `입금 자산`에서 제외되고 archived/all에는 남으며, 순자산과 월간 통계 값은 보관 전과 동일해야 한다.
7. `보관 자산 N개`를 열어 compact 행과 읽기 전용 상세를 확인한다. 수정·복원·정리 행동은 없어야 한다.

### B. 필수 결제 계좌 blocker

1. 새 가계부의 기본 계좌 상세를 연다. 이 계좌는 기본 신용카드와 체크카드의 결제 계좌다.
2. preview dialog에서 연결된 자산명과 blocker 종류를 확인한다.
3. `자산 완전 삭제`·`자산 보관` 최종 행동은 없어야 하고 연결 자산 설정 link만 제공되어야 한다.
4. dialog의 취소, `Escape`, 브라우저 뒤로 가기는 URL을 오염시키지 않고 원래 trigger로 focus를 돌린다.

### C. 두 세션 preview 경합

1. 세션 A가 무이력 자산의 `DELETE` preview를 연다.
2. 독립 세션 B가 같은 자산에 실제 수입 거래를 기록해 disposition과 잔액을 바꾼다.
3. A의 오래된 token apply는 `412 ASSET_REMOVAL_PREVIEW_STALE`이며 자산은 active 상태로 남아야 한다.
4. A dialog는 닫히지 않고 `정리 결과가 달라졌어요` 경고에 focus한다. 최종 행동은 사라지고 `최신 내용 다시 확인`만 남는다.
5. 사용자가 재확인하면 새 결과는 `ARCHIVE`와 최신 잔액·이력을 보여야 한다. 자동 실행하지 않는다.

### D. 반응형·접근성

- 390×844, 768×1024, 1024×768, 1280×900에서 동일 dialog node·preview 결과·focus를 유지한다.
- dialog는 viewport 안에 있고 내부·페이지 가로 overflow가 없다.
- 모바일은 좌우 16px 여유를 유지하고 iPad·desktop은 중앙의 제한 폭 dialog다.
- 닫기와 최종 행동은 최소 44×44px이며 accessible name을 가진다.

## 4. 계층별 중복 방지

- PostgreSQL integration: hard delete FK 정합성, archive posting 보존, deleted 거래 포함 이력 판정, 행 잠금, 50개 제한 경합, 모든 blocker/schedule 상태 조합.
- API contract: enum·필수 필드·status query, `409`/`412` ProblemDetail 스키마.
- Playwright: 사용자가 보는 판정·성공 전환·cache 갱신·선택기 제외·순자산/통계 보존·독립 세션 재확인·반응형 dialog.

## 5. 실패 증거와 재현

artifact에는 비밀값(`previewToken`, CSRF, cookie, password, idempotency key, 거래 내용)을 넣지 않는다. seed manifest에는 synthetic 사용자 ID, 자산/거래 ID, 기준 월, migration `V15`만 기록한다.

```bash
cd e2e
npx playwright test tests/asset-removal.spec.ts --project=desktop-chrome
```
