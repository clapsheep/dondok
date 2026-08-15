# Dondok QC와 자동화 테스트 전략

## 1. QC 역할

QC는 프론트엔드·백엔드 구현 역할과 독립적으로 인수 조건과 회귀 테스트를 관리한다.

- 요구사항과 API 계약으로 테스트를 작성한다.
- 제품 코드를 테스트에 맞게 임의 수정하지 않는다.
- 실패를 숨기기 위한 selector 완화, 고정 sleep, 과도한 retry를 사용하지 않는다.
- 실패를 프론트엔드·백엔드·계약·테스트·인프라로 분류한다.
- 담당 역할에 증거와 단일 테스트 재현 명령을 제공한다.
- 수정 후 같은 테스트와 영향 범위 회귀 테스트를 실행한다.
- 실행 가능한 기능이 생기기 전에는 실패하는 placeholder나 무기한 `test.skip`을 만들지 않는다.

Playwright는 `회원가입 → 이메일 인증 → 서버 세션 로그인 → 브라우저 재실행 상당의 자동 로그인 → 로그아웃·쿠키 폐기 → 재로그인 → 비밀번호 재설정 메일 → 새 비밀번호 저장·로그인`과 `첫 진입 선택 → 가계부 생성 → 6자리 코드·별도 초대 URL 발급 → 다른 사용자 미리보기·수락 → 양쪽 구성원 확인` 흐름을 모바일 Chrome, iPad 세로, 데스크톱 Chrome에서 검증한다. 자동 로그인 검사는 `DONDOK_SESSION`이 `HttpOnly`·`SameSite=Lax`와 약 90일의 만료 시각을 가지고 새 browser context에서 같은 서버 세션을 복원하며, 명시적 로그아웃 뒤 쿠키와 서버 세션을 다시 사용할 수 없음을 확인한다. PostgreSQL integration test는 직접 코드 digest 중복 거부, 기존 긴 token 마이그레이션 보존, 동일 초대의 동시 수락, 동일 사용자의 서로 다른 가계부 동시 수락, 동일 사용자의 가계부 동시 생성을 검증한다.

## 2. 테스트 계층

1. Backend unit: posting, 카드 cycle, 통계 제외, 카테고리 remap policy
2. Frontend unit/component: 폼 기본값, KRW/DATE, query cache, 접근성
3. PostgreSQL integration: FK/unique, category remap, idempotency, cascade deletion
4. API contract: OpenAPI request/response, ProblemDetail, version 충돌
5. Playwright E2E: 핵심 사용자 흐름과 프론트–백엔드–DB 연결

같은 조합을 모든 계층에서 반복하지 않는다. 계산 규칙은 unit/integration에 집중하고 E2E는 실제 사용자 가치와 계층 연결을 검증한다.

## 3. Playwright 구조

```text
e2e/
├── playwright.config.ts
├── fixtures/
│   ├── app.fixture.ts
│   ├── auth.fixture.ts
│   ├── api.fixture.ts
│   └── ledger.fixture.ts
├── pages/
│   ├── login.page.ts
│   ├── invitation.page.ts
│   ├── assets.page.ts
│   ├── transactions.page.ts
│   └── statistics.page.ts
├── specs/
│   ├── membership.spec.ts
│   ├── assets.spec.ts
│   ├── transactions.spec.ts
│   ├── categories.spec.ts
│   ├── card-settlement.spec.ts
│   └── ledger-delete.spec.ts
└── support/
    ├── evidence.ts
    ├── assertions.ts
    └── test-data.ts
```

- Page Object는 화면 위치와 사용자 동작만 캡슐화한다.
- 업무 assertion은 spec에 남긴다.
- `getByRole`, `getByLabel`, `getByText`를 우선한다.
- 의미 있는 locator가 없는 동적 대상만 `getByTestId`를 사용한다.
- `nth()`, 긴 CSS selector, 고정 `waitForTimeout`을 금지한다.
- 테스트마다 고유 사용자·가계부를 API로 seed하고 실행 순서 의존을 금지한다.
- 멀티 사용자 시나리오는 멤버별 독립 browser context를 사용한다.
- 카드 날짜 테스트는 서버 `Clock`, 브라우저 timezone, seed 기준일을 고정한다.

## 4. 핵심 E2E 시나리오

### 멤버십과 초대

- A가 가계부를 만들고 B·C가 별도 세션에서 참가
- 가계부가 없는 첫 화면에서 `바로 시작하기`와 `초대 코드 입력하기`가 명확히 분리됨
- 발급된 직접 코드는 숫자 6자리이고 공유 URL token과 다르며, 반복 확인은 rate limit됨
- 모든 멤버가 같은 데이터 조회
- 로그인 ID 검색 UI/API 없음
- 만료·사용 완료 초대 코드 거부
- 비멤버 접근 거부

### 동등 권한과 자산 marker

- 신규 가계부 생성 직후 0원의 현금·계좌·신용카드·체크카드가 한 개씩 보이고 체크·신용카드의 기본 계좌 연결이 유지됨
- 신규 자산 폼의 `자산 이름 (선택)`에 직접 입력한 이름이 저장되고, 빈 이름은 `계좌 2`처럼 가장 작은 사용 가능 suffix를 사용
- A가 만든 자산을 B가 수정하고 C가 보관
- B가 만든 카테고리를 A가 수정·삭제
- A/B/공동 소유 자산이 모두에게 보이고 동일하게 편집 가능
- owner marker 변경이 권한을 바꾸지 않음
- 자산 현황의 전체·공동 소유·각 구성원 보기가 같은 소유 marker 부분집합으로 순자산·총자산·총부채·이번 달 카드 결제 금액·다음 달 카드 결제 예정 금액, 그룹 합계와 자산 행을 함께 바꾸고 활성 `n/50`은 전체 기준을 유지
- query 없는 자산 현황 첫 진입은 현재 사용자 `(나)`가 선택되어 자신의 합계와 자산을 먼저 보여주고, 명시적으로 고른 전체·공동·다른 구성원 보기는 URL 직접 진입·새로고침·viewport 변경에도 유지됨
- 유효하지 않은 owner 값은 현재 사용자 보기로 복구되고 API 응답에 현재 사용자가 없는 비정상 상태만 전체로 fallback하며, 0건은 전체 가계부 onboarding과 다른 compact 빈 상태로 표시
- 소유자별 보기는 visible 소제목·사방 테두리·별도 필터 상자 없이 최소 44px text subnav와 선택 하단선으로 표시되고, 활성 개수·도구·요약 사이에 불필요한 전체 폭 구분선이나 페이지 overflow가 생기지 않음
- 자산 소유자 subnav·행·수정 radio와 거래 주체 선택·일별 행·상세·통계 필터가 같은 구성원 ID에 동일한 첫 글자 avatar를 표시하고, 공동 소유는 공동 avatar와 문구를 함께 유지
- A 소유 카드의 결제 계좌로 B 또는 공동 소유 계좌 지정 가능
- 체크카드 지출은 선택한 체크카드를 거래 자산으로 보존하고 연결 계좌 잔액만 한 번 감소
- 적금 신규 등록에서 자동이체 계좌·일이 저장되고 상세 재조회에서도 유지
- 연결 계좌가 없는 신용카드·체크카드·적금 폼에서 계좌 등록 dialog가 새 탭 없이 열리고, 부모 draft를 보존하며, 성공한 계좌를 즉시 자동 선택
- 계좌 등록 dialog의 오류 입력 보존, `Escape`·브라우저 뒤로 가기 닫기, trigger focus 복귀와 모바일·iPad·데스크톱 overlay 경계
- 연결 계좌 후보가 이미 있어도 신용카드·체크카드·적금에서 계좌 추가 dialog가 열리고 생성한 계좌를 즉시 선택
- 일반 자산 등록과 계좌 dialog의 기준일 잔액이 빈 실제 값과 `0` placeholder로 시작하고, 빈 제출과 명시적인 `0` 입력이 모두 `openingBalanceWon: 0`으로 저장
- 잔액 기준일 이전 거래는 달력·일별·월간 통계에는 포함되지만 현재 잔액을 바꾸지 않고, 기준일 당일 거래부터 현재 잔액에 반영
- 잔액 기준일 이전 신용카드 구매는 통계와 구매 관리 이력에는 남지만 카드 현재 잔액·명세·결제 예정액에 중복 반영되지 않고, 이후 환불은 미결제 기준일 명세 또는 실제 결제 계좌를 정확히 보정
- 양수·음수 잔액을 섞은 자산에서 전체·그룹별 총자산·총부채·순자산이 일치하고 각 자산이 고정 system code 그룹에 한 번만 표시
- 순자산이 전체 자산 요약의 핵심으로 한 번 표시되고 총자산·총부채와 이번 달·다음 달 카드 결제 금액이 의미별로 구분되며, 그룹이 모바일·iPad·데스크톱에서 한 열의 고정 순서를 유지
- 자금의 signed 현재 합계, 투자·대출·보험의 기존 잔액 합계와 카드의 두 월 합계가 각 그룹 계약대로 표시되고 긴 원화 금액과 접근 가능한 자산 링크가 수평 overflow 없이 표시
- 그룹 표지는 모바일·iPad·데스크톱에서 14px semibold 본문색을 유지하되 실제 자산 이름보다 강한 위계를 갖지 않음
- 자산 행은 종류·소유자만을 위한 별도 metadata 열을 만들지 않고 필요한 metadata를 자산명 아래 보조행에 두며, 모바일에서는 자산명·metadata를 말줄임 없이 감싸고 iPad 이상에서는 각 줄에만 제한적 말줄임을 적용함
- 전체 보기의 identity 보조행에는 `나`·`공동`·다른 구성원명이 보이지만 소유자별 보기에서는 선택된 소유자를 반복하지 않고, 시각적으로 생략해도 링크의 접근 가능한 이름에는 전체 종류·소유자가 유지됨
- 현금·기타·계좌·적금이 하나의 `자금` 그룹에 표시되고, 음수 계좌도 같은 그룹과 계좌 기능을 유지하며 signed 현재 금액을 `부채` 절댓값으로 바꾸지 않음
- 모바일·iPad·데스크톱에서 `자금` 그룹의 `현재 합계` 금액은 16px을 유지하고 개별 자금 행의 `현재 자산` 금액은 14px로 표시되어 항목보다 합계의 위계가 높음
- 카드 그룹·행은 `부채` 문구나 별도 다음 행 없이 같은 가로줄의 `이번 달 결제 금액 | 다음 달 결제 예정 금액` 두 열을 유지하고, 0원도 생략하지 않으며 두 월 금액을 합산하지 않음
- 모바일·iPad·데스크톱에서 전체 카드 그룹의 이번 달·다음 달 합계는 16px, 개별 카드 행의 같은 두 금액은 14px로 표시되어 항목보다 합계의 위계가 높음
- 자금·카드 등 서로 다른 자산 그룹 사이는 모바일 24px, iPad·데스크톱 32px의 일관된 빈 여백과 전체 폭 1px 시작선으로 구분되고, 시작선은 내부 구분선보다 강하지만 배경·좌우 테두리·둥근 모서리·그림자를 만들지 않음
- 카드 두 열은 480px 미만에서 자산 정보 아래, 그 이상에서 자산 정보와 같은 행에 정렬되며 짧은 visible label과 전체 접근 가능한 이름, DOM 순서, 페이지 overflow 없이 같은 월 의미를 유지
- 모바일에서 소유자 subnav가 한 줄 내부 스크롤로 유지되고 이름을 말줄임하지 않으며, 첫 자산 그룹이 첫 viewport 안에 나타나고 자금·투자·대출·보험의 단일 잔액은 이름 오른쪽에서 불필요한 세로 공간을 만들지 않음
- 데스크톱에서는 목록이 왼쪽 한 열에 계속되고 같은 자산 요약이 오른쪽 sticky rail로 배치되어 긴 목록에서도 전체 합계를 유지하며, 모바일·태블릿에서는 요약이 목록보다 먼저 읽힘
- 현재 달 due date의 미결제 명세는 이번 달 열에, 다음 달 due date의 미결제 명세는 다음 달 열에만 포함되고 지난달·다다음달·결제 완료액은 제외
- 50번째 활성 자산은 생성되고 51번째는 `ASSET_LIMIT_EXCEEDED`로 거부되며 draft 유지
- 기본 4개를 포함한 활성 자산 49개에서 두 세션이 동시에 생성하면 정확히 하나만 50번째로 성공
- 거래·posting 이력과 보존해야 할 비활성 설정 참조가 모두 없는 0원 자산은 authoritative preview가 `DELETE`를 반환하고 최종 실행 뒤 active·archived·all 목록과 상세에서 완전히 사라짐
- 기준일 잔액 업무 이력 또는 일반 거래 이력이 있는 자산은 authoritative preview가 `ARCHIVE`를 반환하고, 보관 뒤 활성 그룹·활성 `n/50`·신규 거래·연결 계좌 선택기에서는 제외되지만 순자산·과거 거래·월간 통계에는 같은 금액으로 남음
- 결제·자동이체 계좌 또는 미처리 카드 결제 일정의 자금 출처인 자산은 blocker 종류·연결 자산명이 표시되고 최종 정리 행동이 제공되지 않으며, 단순 잔액과 미결제 명세는 warning일 뿐 차단하지 않음
- preview 뒤 다른 세션이 이력·잔액·연결·version을 바꾸면 apply는 `412`로 아무 삭제·보관도 반영하지 않고, dialog와 작성 중 상태를 유지한 채 `처리 방법이 달라졌어요`에 focus하고 `최신 내용 다시 확인`만 제공함
- 보관 목록은 compact 행과 `보관` 상태를 제공하고 보관 상세는 읽기 전용이며 복원·수정·새 거래 행동이 없음
- 자산 삭제·보관 dialog는 모바일 390px, iPad 세로·가로, 데스크톱에서 하나의 DOM과 같은 결과를 유지하고 가로 overflow 없이 `Escape`·브라우저 뒤로 가기로 닫힌 뒤 trigger focus를 복구함

### 실제 구성원과 작성자

- A 로그인 시 수입·지출·이체의 사람 선택 기본값 A
- 수입·지출·이체 전환 시 label이 각각 `누가 받았나요?`·`누가 썼나요?`·`누가 옮겼나요?`로 바뀌고 선택값은 유지
- A가 실제 구성원을 B로 바꾸어 저장
- `createdBy=A`, `performedBy=B` 유지
- B가 수정해도 최초 작성자와 실제 구성원이 의도치 않게 변경되지 않음
- 기본 통계는 멤버 필터 없는 가계부 전체

### 카테고리 삭제

- 거래 분류 trigger가 모바일에서는 하단 drawer, iPad·데스크톱에서는 compact dialog를 열고 같은 버튼 목록·선택 의미를 유지
- 결제·입금 자산과 보내는·받는 자산, 카드 정정·자산 설정 연결 계좌가 공통 AssetPicker를 사용하고 모바일은 하단 drawer, `768px` 이상은 trigger에 붙는 popover로 열림
- AssetPicker를 열 때 `모든 자산 보기`가 꺼져 있고 현재 구성원의 개인 자산만 보이며, 켜면 field별 후보 제한 안에서 공동·다른 구성원 자산이 나타남. 닫았다 다시 열면 기본 범위로 돌아가고 기존 공동·다른 구성원 선택과 다른 form draft는 유지됨
- 여러 종류의 자산 후보는 compact 종류 필터로 좁혀지고 option마다 종류 icon·이름·자산 종류·소유자 avatar/marker·현재 잔액 또는 이번 달 카드 결제 예정액이 보이며, 계좌·카드 전용 후보에는 다른 종류가 섞이지 않음
- 자산 picker를 Escape·바깥 영역·닫기와 실제 항목 선택으로 닫으면 trigger에 focus가 복구되고 금액·날짜·분류·사람·내용 draft가 유지되며 320px에서도 페이지 가로 overflow가 생기지 않음
- 마지막 `항목 추가`에서 새 공동 분류를 만들면 목록 cache에 즉시 들어가 선택되며 금액·날짜·자산·사람·내용 draft가 유지됨
- 중복·서버 실패·오프라인은 추가 이름과 거래 draft를 보존하고, `Escape`·닫기 뒤 trigger focus를 복구함
- 설정의 `분류 설정` 메뉴에서 수입·지출 전환과 모든 분류가 compact 버튼으로 제공되고, 선택된 한 분류에만 거래 수·이름 수정·조건부 삭제 행동이 노출됨
- 320px·iPad·데스크톱 재배치에서 선택한 category ID, 추가·수정 draft와 focus가 유지되고 페이지 가로 overflow가 생기지 않음
- 사용 중인 사용자 카테고리를 다른 멤버가 삭제
- 모든 연결 거래가 같은 방향의 기타로 이동
- 금액·날짜·자산·작성자·거래 주체 유지
- 기본 기타는 삭제 불가
- 분류 삭제와 같은 분류의 거래 생성이 경합해도 archive된 분류를 참조하는 활성 거래가 남지 않음
- 두 세션이 같은 분류 이름을 수정하면 늦은 세션은 `412`이고 draft가 유지됨

### 일반 거래 수정과 삭제

- 일반 이체 선택기에는 음수 잔액을 포함한 활성 `BANK` 계좌와 `SAVINGS` 적금만 표시되고 현금·신용카드·체크카드·대출 등은 표시되지 않으며, 두 유형의 후보 합계가 두 개 미만이면 저장할 수 없음
- 현재 사용자·다른 구성원·공동 소유 계좌·적금이 이름·종류·소유 표시로 구분되고, 계좌→적금 납입과 적금→계좌 인출이 출발 `-amount`·도착 `+amount` posting으로 원자 반영되며 수입·지출 통계에서 제외됨
- 허용되지 않은 자산을 출발 또는 도착으로 보낸 직접 API 요청은 `400 TRANSFER_ACCOUNT_OR_SAVINGS_REQUIRED`이고 거래·posting·잔액을 하나도 바꾸지 않음
- 수입·지출 수정이 거래 필드와 posting·자산 잔액·달력 합계를 한 번에 변경
- 수입·지출의 `포함하지 않기`를 켜면 posting·자산 잔액과 일별 원장 행은 유지되고 월간 달력·월 합계·분류·연간 통계에서만 빠지며, 수정으로 다시 포함하면 잔액 변화 없이 집계만 복구
- 일반 이체 수정이 출발·도착 posting을 함께 교체하고 합계 0을 유지
- 체크카드의 연결 계좌가 나중에 바뀌어도 같은 카드 거래 수정은 원래 posting 계좌를 유지
- 계좌로 잘못 기록한 일반 지출을 신용카드 일시불·할부로 수정하면 이전 계좌 차감을 되돌리고 카드 posting, billing snapshot, 회차별 charge와 명세를 한 번만 생성하며 달력 지출은 수정 금액으로 한 번만 집계
- 위 전환이 끝난 신용카드 구매의 재수정·삭제, 거래 유형 변경, 자동 정산 거래의 일반 수정·삭제는 거부하고 카드 기록 정정·환불 흐름으로 안내
- 두 세션의 수정·삭제 경합은 하나만 성공하고 늦은 요청은 `412` 또는 원격 삭제 `404`로 draft를 보존

### 카드 구매와 정산

- 카드 구매가 구매일 지출 통계에 한 번 포함
- 구매 시 결제 계좌 잔액은 그대로이고 결제 예정액 증가
- 올바른 명세와 예정 결제일 배정
- 결제일에 B/공동 계좌 감소, 카드 부채 감소
- 카드 정산·선결제에는 거래 주체가 없고 결제 계좌와 선결제 작성자만 계약대로 기록
- 결제 계좌 잔액보다 큰 정산도 전액 기록되어 계좌가 음수가 됨
- 정산 이체는 수입·지출 통계 제외
- scheduler 반복 실행에도 중복 정산 없음
- 서버 중단 후 재시작 시 미처리 결제만 catch-up
- 기록 정정과 실제 환불이 별도 command로 동작하고, 결제 완료분은 실제 원 결제 계좌로 돌아가며 charge·명세·정산과 카드·계좌 잔액이 한 트랜잭션에서 일치
- 카드 구매 정정과 환불의 집계 제외 상태가 preview token·apply 결과에 보존되고, 제외해도 카드·계좌 posting과 명세 보정은 동일하게 반영
- 같은 명세에 다른 구매가 있을 때 환불·감액 후 유효 청구액을 초과하는 결제액만 최신 결제 계좌부터 반환
- 미결제·일부 결제·복수 계좌 결제·복수 부분 환불·기존 환불 후 정정·보관 계좌 반환을 각각 검증
- preview 후 구매·명세·결제가 바뀌면 apply는 `412`로 아무 행도 반영하지 않고, 동시 환불·idempotency retry는 환불 거래를 하나만 생성
- 2개월 이상 할부 구매가 회차별 명세에 나뉘지만 구매일 지출 통계에는 전체 금액이 한 번만 포함
- 같은 명세에 두 번의 부분 선결제를 실행하고 남은 금액만 정규 결제
- 선결제 합계가 명세 잔액을 넘는 동시 요청은 statement 잠금 뒤 하나만 성공
- 선결제·정규 결제는 모두 통계 제외이고 재시도에도 payment와 정산 이체가 중복되지 않음
- 말일 보정과 공식 공휴일·대체공휴일·임시공휴일 다음 한국 영업일 순연을 고정된 fixture로 검증

### 동시 수정과 재조회

- 두 browser context가 같은 자산 version `n`을 읽고 A가 먼저 저장해 `n+1`이 됨
- B가 version `n`으로 저장하면 `412 VERSION_CONFLICT`, B의 변경은 DB에 반영되지 않고 draft와 서버 최신값이 함께 유지됨
- B가 최신값에 입력을 수동 재적용하면 저장 가능하며 자동 필드 병합은 없음
- 서로 다른 row를 수정하는 두 요청은 불필요하게 충돌하지 않음
- 다른 세션의 변경은 route 재진입·window focus·사용자 새로고침에서 보임
- 삭제된 row를 편집하던 세션은 저장 응답에서 원격 삭제를 확인해도 draft를 보존함

### 가계부 삭제

- A·B·C가 화면을 연 상태에서 가계부 전체 삭제
- 어느 구성원이든 같은 권한으로 삭제할 수 있고 `가계부 삭제` 확인 문구가 일치하기 전에는 요청이 전송되지 않음
- 가계부 하위 데이터 cascade 삭제
- 삭제한 세션과 다른 세션 모두 사용자 계정·HttpOnly 로그인 세션을 유지하고 가계부 없음 화면으로 복귀
- 다른 세션이 다음 API 요청의 `404 LEDGER_NOT_FOUND`로 가계부 전용 캐시만 제거
- stale `expectedVersion`은 `412`로 아무 데이터도 삭제하지 않고 확인 입력을 보존
- 오래 열린 탭의 기존 가계부가 삭제되고 새 가계부가 생성되어 version이 우연히 같아도 `expectedLedgerId` 불일치로 새 가계부를 삭제하지 않음
- 삭제 URL 재접근 시 데이터 미노출
- 다른 가계부와 사용자 계정은 유지

### 반응형과 방향 전환

- 모바일 `320×568`, `390×844`, `430×932`에서 가입·기록·목록·달력·자산·통계의 핵심 행동을 완료
- 새 거래 기록은 모든 viewport에서 `가계부로 돌아가기` 없이 본문 제목부터 시작하고 모바일에도 sticky 문맥 header를 만들지 않음. 거래 수정은 본문 복귀 링크를 반복하지 않고 모바일 sticky 상단 바에 접근 가능한 icon 뒤로가기·유일한 `h1`을 표시
- floating 하단 5탭 dock은 `홈 · 기록 · 자산 · 통계 · 설정`을 320px에서도 각 44px 이상으로 제공하고, 휴대폰의 좌·우·하단 edge와 safe area에서 8px 이상 떨어지며 현재 field·오류·저장·PWA 갱신 prompt를 가리지 않음. 홈에서 자산처럼 긴 화면으로 이동해도 같은 dock DOM과 좌표·크기를 유지함
- 모바일 일반 홈·자산·통계·설정 화면에는 브랜드·설정·로그아웃 상단 바가 없고 콘텐츠가 safe area 다음에서 바로 시작함. 설정 첫 화면에는 별도 `가계부로 돌아가기` 행 없이 화면 모드와 로그아웃을 제공함
- 자산 현황·월간 통계·가계부 설정의 `h1`은 모바일과 데스크톱 모두 24px semibold로 동일함. 모바일 홈은 접근 가능한 `h1`만 유지하고 시각적 제목·기록·새로고침 header를 숨기며 `768px` 이상에서는 같은 24px `가계부` 제목을 표시
- 모바일 거래 입력은 금액 → 날짜 → 분류 → 자산 순서의 전체 폭 단일 열이고 320px에서도 가로 overflow가 없으며, 금액은 48px·18~20px·semibold·tabular·우측 정렬·`원` 단위를 유지함
- 거래 입력의 금액 → 날짜 → 분류 → 자산 → 사람 → 내용은 하나의 연속 흐름이며 관련 없는 두 필드씩 감싸는 반복 구분선이 없음. 데스크톱도 입력 열의 읽기 폭을 제한하고 이체의 보내는 자산 → 받는 자산만 충분한 폭에서 병렬 비교함
- 거래 날짜 trigger는 금액과 같은 전체 폭·48px 높이를 유지하고, 모바일에서는 화면 아래에 붙는 full-width drawer, `768px` 이상에서는 360px 이하 anchored popover를 열며 월 이동·오늘·날짜 선택·Escape 후 focus 복구와 `YYYY-MM-DD` draft 보존을 지원함
- 자산 picker trigger는 모바일에서 약 48px 안에 선택 자산을 식별할 수 있고, drawer option은 52~56px 구분선 행과 줄바꿈 없는 내부 종류 필터를 사용해 페이지 폭과 목록 높이를 불필요하게 늘리지 않음. 종류 필터 전환 전후 drawer의 높이·위쪽 좌표는 같고 넘치는 결과만 내부 스크롤됨
- iPad 세로 `768×1024`, `820×1180`, `834×1194`와 가로 `1024×768`, `1180×820`, `1194×834`에서 전용 재배치 확인
- 데스크톱 `1280×720`, `1440×900`, `1536×864`, `1920×1080`에서 sidebar·표·상세 패널과 콘텐츠 최대 너비 확인
- `1024px` 이상 거래 기록에서 입력 열과 sticky `현재 입력` 요약 rail이 나란히 보이고, 금액·날짜·흐름·사람·내용이 같은 draft에서 즉시 반영되며 작성 control·저장 행동이 중복되지 않음
- 홈의 월 요약은 `1024px` 이상에서 달력 오른쪽 rail, 미만에서 달력 위 한 행으로 재배치되며 같은 수입·지출·순액 의미와 DOM을 유지
- 홈 첫 진입은 현재 구성원의 기록이 선택되고 월 제목은 달력보다 낮은 14px 내외 위계이며, 다른 구성원·모두 선택은 월 합계·날짜 셀·날짜 상세·일별 원장에 같은 `performed_by_member_id` 부분집합을 적용
- 홈 구성원 선택은 query 없음=`나`, member UUID=해당 구성원, `member=all`=모두로 새로고침·월 이동·월간/일별 전환·viewport 변경에도 유지되며 N명·긴 이름에서도 페이지 가로 overflow가 없음
- 모바일 달력의 날짜별 수입·지출은 셀 안에서 말줄임표나 가로 overflow 없이 단위 축약값 전체가 보이고, 날짜 선택 후 전체 화면 일별 상세에서 정확한 원 단위 금액과 거래 내용을 확인
- 같은 날짜 상세 DOM이 `320~767px`에서는 safe area를 반영한 전체 화면, `768px` 이상에서는 달력 위 중앙 dialog가 되며 resize·회전 중 URL 선택일과 query 상태를 유지
- 날짜 상세의 기록 행동은 선택한 날짜를 새 거래 날짜 초깃값으로 전달하고, 모바일 홈의 pull-to-refresh는 맨 위에서 임계 거리 이상 당긴 경우에만 활성 거래 query를 다시 조회하며 전체 문서를 reload하지 않음
- 홈 header에는 모바일·iPad·데스크톱 모두 즉시 기록 링크가 없고, `768px` 이상은 가계부 제목과 명시적 새로고침만 유지하며 날짜 상세 dialog의 기록 행동으로 같은 선택일 기록 흐름을 제공
- 일별 상세의 이전·다음 날은 월·연도 경계를 포함해 정확한 하루 범위만 조회하고 URL의 월·선택일을 동기화하며, 달력 복귀·`Escape`·브라우저 뒤로 가기는 상세만 닫음
- `640`, `768`, `1024`, `1280`, `1536px`의 전후 1px에서 기능·정보 손실과 전체 페이지 가로 overflow가 없음
- iPad 분할 화면 폭과 모바일 가로에서 내비게이션·Sheet 내부 scroll·고정 행동이 겹치지 않음
- 화면 회전과 resize 전후에 가계부·월·날짜·필터·상세·draft·focus·scroll과 TanStack Query 상태가 유지됨
- 모바일 키보드와 네 방향 safe area가 현재 필드·오류·저장·취소·하단 내비게이션을 가리지 않음
- 긴 한글 이름, 큰 원화 금액, N명 구성원, 200% 확대에서도 44×44px touch target과 핵심 정보 유지
- iPad 크기 WebKit 자동 검사와 실제 iPad Safari 핵심 smoke를 반응형 완료 조건에 포함
- OS light/dark 초기값과 기기별 `system/light/dark` override가 reload 뒤 유지되고 초기 theme flash가 없음
- dark의 auth·홈·자산·거래·통계·설정·dialog·dock에서 default·hover·focus·selected·disabled·error·placeholder·icon을 표본 검사하고 본문 4.5:1, 경계·focus·선택 표식 3:1 이상을 유지
- light/dark 구성원 avatar의 글자 대비가 4.5:1 이상이고 avatar를 숨겨도 전체 이름·`나`·공동 소유와 radio의 접근 가능한 이름이 그대로 남음
- 모바일 설정에서 theme를 바꾼 뒤 `768px` 이상으로 resize하거나 반대로 이동해도 설정의 선택 상태와 실제 theme가 일치하고, 앱 상단·sidebar·로그인에는 중복 theme control이 나타나지 않음

### 목록 범위와 통계

- 거래 목록은 cursor가 안정적으로 이어지고 같은 거래의 중복·누락 없이 필요한 page만 요청
- 자산 원장은 `primary_asset_id`로 직접 선택된 거래와 해당 자산 posting이 있는 거래를 한 번씩 합쳐 최신순 cursor로 반환하며, 체크카드 선택 자산·실제 차감 계좌와 이체 출발·도착 계좌 양쪽에서 같은 거래를 찾을 수 있음
- 모바일 자산 원장은 스크롤 끝 근처에서 다음 cursor를 불러오고 page 경계에서도 월 구분자를 연월당 한 번만 표시하며, 거래 행→상세→일반 거래 편집·삭제와 우상단 기어→자산 편집 흐름이 320px 이상에서 가로 overflow 없이 이어짐
- 월간 달력·MVP 통계는 요청한 날짜 범위만 집계하고 전체 거래 목록을 먼저 가져오지 않음
- MVP 통계는 선택 월 수입·지출·순액, 카테고리 비중, 같은 연도 1~12월 수입·지출 합계와 공동 전체 기본값을 검증
- 연간 월별 합계는 선택 월과 같은 필터를 적용하고 누락 월을 0원으로 채우며, 선택 월 합계와 해당 월 막대가 같은 repeatable-read snapshot에서 일치함을 검증
- 분류 비중이 모두 양수면 접근 가능한 이름을 가진 native SVG 원형 차트와 정확한 금액 행을 함께 표시하고, 6개 이하는 모두 유지하며 7개 이상이면 상위 5개 뒤를 `기타 N개` 한 조각으로 합침
- 환불로 선택 방향 합계 또는 분류 순금액이 0 이하이면 원형 차트·비율·막대를 함께 숨기고 signed 금액 행과 환불 반영 안내를 유지함
- 월간 통계 Playwright는 실제 2인 가계부에서 카드 구매·환불과 제외 거래를 합성하고, 거래 주체·현재 자산 소유 marker·분류 AND 필터, 12개월 grouped bar와 exact 월별 목록, URL 복원, 모바일·iPad·데스크톱 동일 의미를 검증

## 5. 요청 추적 계약

모든 HTTP 요청은 `X-Request-Id`를 사용한다.

- 클라이언트 값이 유효하면 유지하고 없으면 서버가 생성
- 응답에 동일한 ID 반환
- E2E profile에서 `X-E2E-Run-Id`, `X-E2E-Test-Id` 추가
- 서버 MDC와 JSON 로그에 request/run/test ID 기록
- 서버 MDC·응답·DB audit에 원 mutation의 correlation ID 기록
- 민감한 쿠키·토큰·비밀번호·초대 코드·거래 메모는 로그와 artifact에서 제거

오류 응답은 Spring `ProblemDetail`을 확장한 안정된 계약을 사용한다.

```json
{
  "status": 412,
  "errorCode": "TRANSACTION_VERSION_CONFLICT",
  "correlationId": "...",
  "timestamp": "2026-07-11T12:00:00Z",
  "fieldErrors": []
}
```

테스트는 변경 가능한 `detail` 문구가 아니라 `status`와 `errorCode`를 assertion한다.

## 6. E2E seed 규약

각 실행은 고유한 `runId`를 사용한다.

```text
e2e-{UTC timestamp}-{worker}-{random}
```

test profile 전용 seed API/CLI는 다음 manifest를 반환한다.

```json
{
  "runId": "...",
  "seedVersion": "ledger-v1",
  "users": {"memberA": "...", "memberB": "..."},
  "ledgers": {"shared": "..."},
  "assets": {"bank": "...", "card": "..."},
  "categories": {"food": "..."}
}
```

- production profile에는 seed endpoint를 등록하지 않는다.
- test login ID와 email에 runId suffix를 붙여 병렬 충돌을 피한다.
- cleanup은 ledger ID 단위로 수행한다.
- 실패 시 선택적으로 짧은 TTL 동안 seed를 보존한다.

## 7. 실패 증거

Playwright 실패 묶음에는 다음을 포함한다.

- 테스트 ID, spec 파일·라인, Git SHA, CI URL
- 브라우저, viewport, locale, timezone, retry/shard/worker
- seed manifest와 고정 clock 값
- 기대값, 실제값, 최초 실패 assertion
- 단일 테스트 재현 명령
- `trace.zip`
- 실패 screenshot
- 필요할 때 video
- browser console/page error
- 마스킹된 network NDJSON 또는 HAR
- request/correlation ID와 같은 ID의 백엔드 로그
- DB migration과 최소 진단 query 결과

CI 기본값:

- trace: `retain-on-failure` 또는 first retry
- screenshot: `only-on-failure`
- video: `retain-on-failure`
- HTML + JUnit report

## 8. 책임 분류

| 분류 | 최초 계약 위반 |
|---|---|
| FRONTEND | API는 정상이지만 DOM, 폼, 접근성, 캐시, 충돌·재조회 화면 반영이 잘못됨 |
| BACKEND | API 업무 결과, DB 상태, 계산, scheduler, idempotency가 잘못됨 |
| CONTRACT | OpenAPI, 필드 의미, enum, 오류 코드, 날짜·금액·version 계약 불일치 |
| TEST | selector, seed, assertion, 격리, test clock 오류 |
| INFRA | 프로세스 미기동, DB 연결, DNS, 브라우저 crash, CI 자원 문제 |
| UNKNOWN | 증거가 부족해 최초 단절 지점을 판단할 수 없음 |

담당은 사용자에게 보인 마지막 증상이 아니라 다음 순서의 최초 단절 지점으로 정한다.

```text
브라우저 요청
→ API 응답
→ 서버 완료 로그
→ DB commit
→ TanStack Query update/invalidate 또는 재조회
→ DOM
```

## 9. 버그 리포트

```text
제목: [영역][심각도] 관찰된 결과
빌드/환경: Git SHA, 브라우저, DB migration, timezone
테스트: ID, spec, 케이스명
사전 조건: seed version, run ID, 고정 날짜
재현 절차:
1.
2.
3.
기대 결과:
실제 결과:
영향 범위:
담당 분류: FRONTEND | BACKEND | CONTRACT | TEST | INFRA | UNKNOWN
Request/Correlation ID:
관련 데이터 ID:
증거 경로:
최초 실패 지점:
재현 빈도:
회귀 테스트 계획:
```

데이터 유실, 중복 카드 정산, 다른 가계부 데이터 노출은 최상위 심각도로 취급한다.

## 10. 품질 게이트와 flaky 정책

공식 브라우저 범위:

- 정식 지원: Chrome desktop/Android, Edge desktop, macOS Safari, iOS/iPadOS Safari
- 보조 smoke: Firefox desktop
- PR 차단: 대표 Chromium viewport 핵심 흐름
- 릴리스 차단: Chromium 전체 핵심, Playwright WebKit, 실제 iPhone/iPad Safari 핵심, Firefox smoke

PR 필수:

- 정적 분석과 build
- 프론트·백엔드 unit test
- PostgreSQL integration test
- OpenAPI drift 검사
- 핵심 Chromium E2E
- 실패 artifact 업로드

릴리스 필수:

- 전체 Chromium E2E
- WebKit 자동 검사와 실제 Safari 핵심 smoke, Firefox smoke
- 이전 버전 migration
- 카드 scheduler/idempotency
- 같은 row version 동시성·cascade 삭제
- 최신 daily와 표본 weekly off-device 백업 복원, 삭제된 가계부가 다시 서비스되지 않는 절차 검증
- 일일 백업은 저장소 밖 0700 root·0700 bundle·0600 dump/checksum/manifest, custom archive list, manifest image digest·Flyway 일치와 성공 뒤 30×24시간 rotation을 검증
- retention fixture는 29일 유지, 정확히 30일·31일 제거, partial·symlink·외부 target 보존, dry-run/실제 대상 일치와 외부 maintenance lock 미제거를 검증
- 복구 drill은 live DB·live volume·외부 port 없이 network-none throwaway PostgreSQL에 single transaction으로 복원하고 성공·실패 후 자기 container·volume·lock이 0개인지 검증
- 손상 dump는 checksum 단계에서 복구 container 생성 전에 거부하고, 삭제 denylist가 없거나 빈 경우 disaster cutover 성공으로 취급하지 않음
- 주요 접근성 검사

보존:

- 실패 seed는 합성 데이터만 24시간 보존
- trace·screenshot·마스킹한 network·log 등 실패 artifact는 14일 보존
- public 저장소 artifact에는 cookie·token·초대 코드·거래 메모·백업 파일을 포함하지 않음

Flaky 정책:

- CI retry 최대 1회, 진단용으로만 사용
- retry 성공도 flaky로 기록
- 핵심 금융·삭제·보안 테스트 quarantine 금지
- 일반 quarantine은 이슈·담당자·만료일 필수
- retry 수를 늘려 해결하지 않음
- 미해결 데이터 정합성 flaky가 있으면 릴리스 차단
