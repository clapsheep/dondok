# 공동 월간 통계 QC 인수 기준

이 문서는 D-038과 OpenAPI 0.10의 월간 통계를 PostgreSQL/Spring 통합 테스트와 대표 Playwright 사용자 흐름으로 나누어 검증하는 기준이다. 통계는 읽기 모델이므로 거래·카드 posting 생성 자체를 브라우저에서 다시 증명하지 않고, 실제 API seed가 통계 화면과 URL 상태로 정확히 연결되는지를 E2E의 중심으로 둔다.

## 영향 범위와 source of truth

| 규칙 | 최소 증명 계층 | Playwright에서 확인할 결과 |
|---|---|---|
| 한 달 반개구간과 해당 연도 12개월 zero-fill | Backend integration | 선택 월 label과 12개월 grouped bar·exact 목록 |
| 공동 전체 기본값 | API integration + E2E | 필터 없는 이번 달 URL·수입·지출·순액 |
| 거래 주체·현재 자산 소유자·분류 AND | Backend integration + E2E | 세 필터를 함께 적용한 query와 결과 범위 |
| `primary_asset_id` 기준 소유자 | Backend integration | 필터 설명과 적용 결과가 posting 출금 계좌를 소유자로 오해하지 않음 |
| 카드 구매 포함 | Transaction/Statistics integration + E2E | 구매 월 지출과 선택 월 분류 순금액에 한 번 포함 |
| 이체·최초 금액·선결제·정산 제외 | Statistics integration + 대표 E2E | seed manifest의 제외 금액이 월 합계·연간 막대에 더해지지 않음 |
| 실제 환불의 음수 지출 | Card/Statistics integration + E2E | 환불 월 음수 지출, signed 합계와 비율 숨김 안내 |
| 월·필터·분류 방향 URL 보존 | Frontend unit + E2E | reload·뒤로가기·회전·viewport 변경 후 동일 상태 |
| 설정 utility와 최종 핵심 메뉴 | E2E | `홈 · 기록 · 자산 · 통계`, 별도 접근 가능한 `설정` |
| 반응형·접근성 | Playwright | 390px, iPad 세로/가로, desktop에서 같은 값·DOM·focus |

## HTTP 계약

- `GET /api/statistics/monthly`는 `month=YYYY-MM`을 필수로 받고 해당 월 시작부터 다음 달 시작 전까지 한 번에 집계한다.
- 선택 query는 `performedByMemberId`, `assetOwnerType=ALL|JOINT|MEMBER`, `assetOwnerMemberId`, `categoryId`이며 서로 다른 그룹은 AND다.
- 거래 주체는 작성자가 아닌 `performed_by_member_id`, 자산 소유자는 거래의 `primary_asset_id`에 붙은 현재 marker다.
- 응답의 `appliedFilters`가 요청을 authoritative하게 되돌려주며 `totals`, 방향별 `categoryBreakdown`, 선택 연도의 1~12월 `yearlyTrend`를 같은 repeatable-read snapshot으로 반환한다.
- 이전 PWA 앱 셸의 갱신 prompt가 새 API와의 교차 배포 중에도 렌더링되도록 deprecated `dailyTrend`는 빈 배열로만 반환하며 새 화면은 읽지 않는다.
- 금액은 원 단위 signed integer다. `expenseWon`은 환불 때문에 음수가 될 수 있고 `netWon = incomeWon - expenseWon`이다.
- 조회는 월별 통계 endpoint만 사용하며 거래 전체 목록을 먼저 읽어 클라이언트에서 재집계하지 않는다.

## Backend 자동화 기준

1. 선택 월 경계 밖 거래와 삭제 거래가 선택 월 합계에 섞이지 않는지, 해당 연도 밖 거래가 연간 합계에 섞이지 않는지, 누락 월을 포함해 12개월 배열을 검증한다.
2. `INCOME`, `EXPENSE`, 카드 구매와 실제 환불만 포함하고 일반 이체, `OPENING_BALANCE`, `CARD_PREPAYMENT`, `CARD_SETTLEMENT`는 제외한다.
3. 거래 주체, `primary_asset_id`의 현재 개인·공동 소유 marker, 분류를 각각 또는 함께 적용해 AND 결과를 검증한다.
4. 체크카드처럼 posting 계좌와 주 자산이 다른 거래, 자산 보관과 이후 소유 marker 변경에도 현재 marker 규칙을 지킨다.
5. 분류 이름 변경과 삭제 후 같은 방향 `기타` 이동을 현재 통계에 반영한다.
6. 다른 가계부의 멤버·분류, 잘못된 owner filter shape는 안정된 `STATISTICS_*` 오류로 거부한다.

## Playwright 합성 원장

각 실행은 실제 가입·가계부·초대 수락으로 두 구성원을 만들고 기존 API와 CSRF/idempotency 계약으로 다음 데이터를 seed한다.

| 월 | 주체 | 주 자산 소유 | 분류 | 종류 | 통계 금액 |
|---|---|---|---|---|---:|
| 이번 달 | A | A | 기타 수입 | 수입 | +500,000원 |
| 이번 달 | B | 공동 | 기타 수입 | 수입 | +100,000원 |
| 이번 달 | A | A | 식비 | 지출 | 10,000원 |
| 이번 달 | B | A | 식비 | 지출 | 20,000원 |
| 이번 달 | B | 공동 | 식비 | 지출 | 30,000원 |
| 이번 달 | B | 공동 | 교통비 | 지출 | 40,000원 |
| 이번 달 | B | A 카드 | 식비 | 카드 구매 | 120,000원 |
| 지난 달 구매·이번 달 환불 | B | A 카드 | 식비 | 실제 환불 | -400,000원 |

공동 자산의 최초 금액 777,777원, 일반 이체 50,000원, 카드 선결제 30,000원은 같은 seed에 만들지만 통계에는 포함하지 않는다. 자동 정산 제외는 고정 Clock backend 통합 테스트를 source of truth로 사용한다.

이번 달 공동 전체 기대값은 수입 `600,000원`, 지출 `-180,000원`, 순액 `780,000원`이다. 식비 순금액은 `-220,000원`, 교통비는 `40,000원`이다. `주체 B AND 공동 소유 AND 식비`는 공동 식비 30,000원 한 건만 남아야 한다.

## E1. 공동 전체·포함/제외·환불 표현

1. `통계` 핵심 메뉴로 첫 진입하면 이번 달, `공동 전체`, 지출 분류 방향이 선택된다.
2. 요약 `dl`은 수입 `+600,000원`, 지출 `+180,000원`, 순액 `+780,000원`을 label과 함께 보여준다. 지출 원본 합계가 -180,000원이므로 화면 효과 부호는 `+`다.
3. 식비는 환불 반영 순금액이 -220,000원이므로 `+220,000원`, 교통비는 `-40,000원`으로 읽힌다.
4. 선택 방향 전체 또는 한 분류가 0 이하이므로 비율과 막대를 모두 숨기고 `환불을 반영해 비율 대신 분류별 순금액을 보여드려요`를 한 번 안내한다.
5. 해당 연도의 grouped bar는 1월부터 12월까지 수입·지출 두 막대를 제공하며 이번 달 exact 목록은 수입 `+600,000원`, 지출 `+180,000원`이다. 이전 달 카드 구매가 같은 연도면 이전 달 지출에도 한 번 나타난다.
6. 일반 이체·최초 금액·선결제는 선택 월 합계와 연간 월별 통계에 추가되지 않는다.
7. 수입 방향으로 전환하면 기타 수입 600,000원과 정상 비율을 보여주고 `direction=income`을 URL에 보존한다.

## E2. 세 필터 AND와 URL 상태

1. filter trigger는 적용 전 `공동 전체` 의미, `aria-expanded=false`, 연결된 dialog 이름을 제공한다.
2. dialog는 `거래 주체`, `자산 소유자`, `분류` 세 `fieldset`과 각 `전체`를 포함한 단일 선택 radio를 제공한다.
3. B, 공동 소유, `식비 · 지출`을 draft로 고르는 동안 결과와 URL은 바뀌지 않는다.
4. 회전과 breakpoint 통과 뒤에도 radio draft와 focus가 유지되고 적용 뒤에만 `member`, `owner=joint`, `category`가 URL에 들어간다.
5. 월 API query가 세 filter를 함께 보내고 결과는 지출 30,000원·순액 -30,000원이다. 적용 결과는 polite live status로 한 번 알린다.
6. reload·다음/이전 월·브라우저 뒤로 가기에서 월, 세 filter, 분류 방향을 복원한다. `Escape`와 첫 browser back은 dialog만 닫고 trigger focus를 복원한다.
7. 필터 결과가 빈 지난 달에는 공동 전체 empty와 구분되는 조건 empty 및 `필터 초기화`를 제공한다.

## E3. 월 이동·정보 구조·반응형

- 이전 달·다음 달은 최소 44×44px이고 현재 달이 아닐 때만 `이번 달` 복귀 행동을 제공한다.
- 최종 핵심 메뉴는 `홈 · 기록 · 자산 · 통계`이며 `설정`은 핵심 메뉴에 중복하지 않고 프로필·utility에서 접근 가능하다.
- `390×844`, `768×1024`, `1024×768`, `1280×900`에서 월·filter·direction·focus와 같은 TanStack Query 결과를 유지한다.
- 모바일은 수입·지출 2열과 순액 전체 폭, iPad 세로는 요약 한 행·분석 한 열, iPad 가로/desktop은 분류와 연간 막대 두 열이다.
- 12개월 grouped bar는 페이지 가로 overflow 없이 같은 DOM으로 유지하고, 정확한 값은 월별 `time`과 `dl`을 가진 월별 금액 목록으로 제공한다.
- 원 단위 금액은 중간 줄바꿈하거나 임의 축약하지 않고 전체 페이지 가로 overflow가 없다.
- filter trigger·radio·적용·초기화·분류 방향·월 이동의 조작 영역은 44px 이상이다.

## 실패 증거

- `X-E2E-Run-Id`, `X-E2E-Test-Id`를 모든 요청에 넣는다.
- network artifact에는 query 값을 제거한 API path, method, status, `X-Request-Id`만 남긴다.
- console·page error, 합성 사용자/멤버/자산/분류/거래 ID와 migration V14 seed manifest를 첨부한다.
- cookie, CSRF token, invitation code, idempotency key, 비밀번호와 거래 내용은 artifact에 저장하지 않는다.
- 실패 시 trace, screenshot, video와 최초 단절 지점을 `FRONTEND`, `BACKEND`, `CONTRACT`, `TEST`, `INFRA` 중 하나로 분류한다.

```bash
cd /Users/clapsheep/Documents/dondok/e2e
npx playwright test tests/statistics.spec.ts --project=desktop-chrome --workers=1
```
