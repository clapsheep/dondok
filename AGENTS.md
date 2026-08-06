# 돈독 저장소 작업 규칙

## 시작 전

- 구현·수정·리팩터링 전 [`docs/project-context.md`](docs/project-context.md)와 [`docs/product/open-decisions.md`](docs/product/open-decisions.md)를 읽고 이미 확정된 결정을 다시 질문하지 않는다.
- 돈독 기능을 실제로 변경할 때는 `$deliver-dondok-feature`를 사용한다.
- 아직 사용자가 개발 시작을 선언하지 않았다면 애플리케이션 scaffold를 만들지 않는다. 문서·설계·하네스 준비만 수행한다.
- 현재 작업의 결정 기한에 도달한 `OPEN` 질문은 추론하지 말고 사용자에게 최대 3개씩 묻는다. 문서의 권고안은 사용자 결정이 아니다.
- 요구 결과를 바꾸지 않는 안전하고 되돌릴 수 있는 세부사항은 합리적인 기본값으로 진행하고 기록한다.
- 서브에이전트는 PM·DB·Frontend·Backend·QC·UX/UI의 고정 역할만 재사용한다. 질문별 일회성 에이전트를 새로 만들지 않으며, 공통 결정은 `docs/project-context.md`와 `docs/product/open-decisions.md`로 동기화한다.

## 제품 불변조건

- 가계부는 활성 멤버 N명이 동일한 편집 권한으로 공유한다.
- 한 사용자는 동시에 하나의 가계부에만 참여하며 개인 나가기는 제공하지 않는다.
- 로그인 아이디는 인증 전용이고 공개 핸들·사용자 검색 없이 비밀 초대 URL·코드만 사용한다.
- 초대는 가계부 확인 후 즉시 참여하며 발급 후 7일 동안 한 번만 사용할 수 있다.
- 자산 소유자는 권한이 아니라 특정 멤버 또는 공동 소유를 나타내는 marker다.
- 거래의 경제활동 주체와 작성자를 분리한다. 주체는 구성원 한 명이고 본인이 기본이며 다른 구성원을 선택할 수 있다.
- 원화만 지원하며 금액은 정수 원 단위다. 경제활동일은 `DATE`다.
- 사용자가 입력하는 금액은 `잔액 기준일` 시작 시점의 `기준일 잔액`이다. 기준일 이전 거래는 통계·원장 이력에는 남지만 기준일 이후 잔액에는 다시 더하지 않고, 기준일 당일 이후의 유효 posting만 기준일 잔액에 합산한다.
- 잔액 기준일 이전 신용카드 구매도 통계·원장 이력에는 남기되 카드 명세에 다시 청구하지 않는다. 기준일 이후 환불은 기준일 카드 잔액의 미결제분을 먼저 줄이고, 이미 결제한 금액은 실제 결제 계좌로 반환한다.
- 카드 구매는 구매일 지출 통계에 반영하고, 결제일 정산은 자산만 이동하며 수입·지출 통계에서 제외한다.
- 카드 일시불·할부와 결제일 전 부분·복수 선결제를 지원하고, 할부 이자는 사용자가 별도 거래로 기록한다.
- 거래가 연결된 분류 삭제는 같은 방향 `기타`로 이동한다. 거래가 연결된 자산은 삭제하지 않고 보관한다.
- 동시 수정은 편집 시작 version과 저장 version이 다르면 `412`로 전체 저장을 거부하고, idempotency/unique/필요한 행 잠금으로 경합을 제어한다. MVP에는 SSE와 sync outbox를 두지 않는다.
- 모든 화면은 모바일, iPad·태블릿 세로/가로, 데스크톱에서 기능과 데이터 의미를 동일하게 유지한다. breakpoint 변경과 회전으로 draft·필터·focus·TanStack Query 상태를 초기화하지 않는다.
- 카드 정산은 경제활동 주체 없이 결제 계좌를 자금 출처로 기록하고, 결제 계좌 잔액이 부족해도 전액 posting해 음수 잔액을 허용한다.
- 한 가계부의 활성 자산은 최대 50개며, 거래 목록은 cursor pagination으로 필요한 범위만 조회한다.

## 코드 경계

- `backend/`, `frontend/`, `e2e/`, `infra/`를 독립 경계로 유지한다.
- 백엔드는 feature-first modular monolith, 명확한 application/domain/infrastructure 경계를 따른다.
- JPA deep inheritance를 사용하지 않는다. 공통 영속 데이터는 단순 entity, 특수성은 composition, 행위 차이는 Strategy/Policy/Factory로 둔다.
- 프론트엔드는 React SPA, Vite, TypeScript, React Router, TanStack Query, shadcn/ui, Tailwind, `vite-plugin-pwa`를 사용한다.
- PWA service worker는 버전된 정적 앱 셸만 캐시한다. API·금융 데이터 캐시와 오프라인 mutation queue를 만들지 않고 새 버전은 draft를 보존하는 갱신 prompt로 적용한다.
- 전역 반응형 구간은 공통 Tailwind breakpoint와 UX 계약을 사용하고, 컴포넌트 내부 재배치는 container query를 우선한다. UA나 JS `window.innerWidth`로 동일 화면의 DOM을 이중 구현하지 않는다.
- 프론트엔드와 백엔드는 서로의 소스에 의존하지 않고 OpenAPI와 HTTP 계약으로만 연결한다.
- Flyway migration은 한 위치만 실행 원본으로 둔다.

## 변경 절차

1. 현재 문서·코드·테스트와 작업 트리를 확인한다.
2. DB, API, backend, frontend, client cache/shared-session, UX, QC 중 영향 범위를 표시한다.
3. 외부 계약이나 데이터 구조가 바뀌면 구현 전에 migration/OpenAPI/event 계약을 먼저 맞춘다.
4. 위험에 비례해 테스트한다. 금액 posting, 권한, 삭제, 카드 정산, 동시성, idempotency와 버그 회귀는 반드시 자동화한다. 단순 getter나 프레임워크 동작을 반복 검증하지 않는다.
5. 가장 작은 수직 기능 단위로 구현한다.
6. 관련 test, lint, build와 실제 사용자 흐름을 실행하고 결과를 읽은 뒤에만 완료를 말한다.
7. 제품 결정이 달라졌다면 `docs/project-context.md`와 관련 상세 문서를 같은 변경에 갱신한다.

## 품질과 오류 인계

- 버그를 추측으로 고치지 말고 `$systematic-debugging`으로 최초 계약 파손 지점을 찾는다.
- 완료 전 `$verification-before-completion`으로 실제 명령 결과를 확인한다.
- React 기반 프론트엔드로 결정되면 `$vercel-react-best-practices`를 적용하고 선택하지 않은 runtime 전용 규칙은 강제하지 않는다.
- QC Playwright 실패는 trace, screenshot, console, network, seed manifest, request ID를 보존한다.
- 테스트는 접근 가능한 role/label을 우선하고 긴 CSS selector와 순번 의존을 피한다.

## 보안과 도구

- `.env`, secret, token, 개인 데이터와 운영 DB 내용을 Git, 로그, 프롬프트, MCP에 넣지 않는다.
- `VITE_*`는 공개 설정만 허용한다.
- Context7은 공개 라이브러리의 버전별 문서를 찾을 때만 사용하고 사유 코드나 사용자 데이터를 보내지 않는다.
- GitHub 작업은 이미 설치된 GitHub plugin을 우선하며 중복 GitHub MCP를 추가하지 않는다.
- DB MCP가 필요해져도 개발·테스트 DB read-only로만 연결하며 운영 DB에는 연결하지 않는다.
- Docker socket을 광범위한 MCP에 노출하지 않는다. 배포는 검토 가능한 Dockerfile과 Compose 명령을 사용한다.

## Git과 환경

- 사용자의 기존 변경을 보존하고 관련 없는 파일을 수정하지 않는다.
- 요청 없이 commit, push, PR 생성, dependency 대규모 upgrade를 하지 않는다.
- production dependency 추가 전 필요성과 대안을 설명한다.
- 환경변수 변경 시 `.env.example`과 운영 문서를 함께 갱신한다.
- 하네스 검사는 `bash .agents/skills/deliver-dondok-feature/scripts/verify-harness.sh`로 실행한다.
