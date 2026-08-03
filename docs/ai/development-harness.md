# 돈독 AI 개발 하네스

## 결론

돈독에는 많은 MCP를 항상 켜 두는 구성보다 **저장소 규칙 + 작업별 skill + 최소 MCP + CI/QC 강제**가 적합하다. MCP는 외부의 최신 정보나 실제 서비스 조작이 필요할 때만 쓰고, 프로젝트의 도메인 지식은 Git에 남는 문서와 repo skill을 기준으로 한다.

## 구성 계층

| 계층 | 역할 | 돈독 구성 |
|---|---|---|
| `AGENTS.md` | 모든 작업에 항상 적용되는 불변조건 | 도메인, 폴더 경계, 보안, 검증 규칙 |
| Repo skill | 특정 종류의 반복 워크플로 | `$deliver-dondok-feature` |
| 외부 skill | 검증된 범용 전문 지식 | React 성능, 체계적 디버깅, 완료 전 검증 |
| MCP/plugin | 최신 문서나 외부 시스템 접근 | OpenAI Docs, Context7, 기존 GitHub plugin |
| 자동화 | 규칙의 기계적 강제 | harness 검사, 이후 CI와 Playwright |

Codex는 저장소 루트부터 현재 디렉터리까지 `AGENTS.md`를 계층적으로 읽고, repo skill은 `.agents/skills`에서 발견한다. 앱 생성 시 `backend/AGENTS.md`, `frontend/AGENTS.md`, `e2e/AGENTS.md`를 추가해 각 빌드·테스트 명령만 더 구체화한다.

## 고정 역할 에이전트 운영

돈독의 협업 역할은 `ProjectManager · Database · Frontend · Backend · QC · UX/UI`로 고정한다. 질문이나 기능마다 새 이름의 일회성 서브에이전트를 만들지 않는다.

- 이미 존재하는 역할 에이전트가 있으면 follow-up으로 재사용한다.
- 동시 실행 슬롯 때문에 모든 역할을 항상 실행 상태로 둘 수 없더라도 역할 이름과 책임은 바꾸지 않는다.
- 작업에 필요한 역할만 활성화하고, 공통 계약 변경을 먼저 `docs/project-context.md`와 `docs/product/open-decisions.md`에 기록한다.
- 각 역할은 작업 시작 시 두 문서를 다시 읽어 이전 역할의 결정을 이어받는다.
- 병렬 작업은 파일 소유자를 한 명으로 정하고, 질문별 임시 에이전트나 중복 역할을 추가하지 않는다.

서브에이전트 대화 자체는 영속적인 제품 기억의 원본이 아니다. Git에 남는 공통 문서가 모든 역할의 장기 기억이며, ProjectManager가 문서와 역할 간 모순을 관리한다.

## 지금 설치한 project skills

### `vercel-react-best-practices`

- 용도: React 렌더링, waterfall, bundle, rerender 검토
- 출처: Vercel Labs
- 조사 시점 규모: 약 54만 설치, GitHub 약 2.9만 star
- 보안 평가: Gen/Socket/Snyk 통과
- 적용: React SPA + Vite로 확정됐다. React 성능 규칙을 적용하되 서버 상태는 TanStack Query를 사용하고 Next.js 전용 규칙은 강제하지 않는다.

### `systematic-debugging`

- 용도: 증상 패치 전에 재현, 계층 경계 증거, 단일 가설 검증
- 출처: obra/superpowers
- 조사 시점 규모: 약 18만 설치
- 보안 평가: Gen/Socket/Snyk 통과
- 돈독 적합성: request ID → backend → DB/audit → HTTP 응답 → TanStack Query → DOM 순서와 잘 맞는다.

### `verification-before-completion`

- 용도: test/lint/build/실제 흐름의 최신 실행 결과 없이 완료를 주장하지 않게 함
- 출처: obra/superpowers
- 조사 시점 규모: 약 14만 설치
- 보안 평가: Gen/Socket/Snyk 통과

`skills-lock.json`이 출처를 기록한다. 다른 환경에서는 저장소 루트에서 다음으로 복원한다.

```bash
npx skills experimental_install
```

업데이트는 자동으로 받지 않는다. `npx skills check`로 확인하고 upstream diff와 보안 평가를 읽은 후 `npx skills update -p`를 실행한다.

## 돈독 전용 skill

[`deliver-dondok-feature`](../../.agents/skills/deliver-dondok-feature/SKILL.md)는 멤버, 자산, 거래, 분류, 카드, 통계, 동시성, 배포 변경을 DB–API–Frontend–Client consistency–QC 수직 기능으로 다룬다. 위험도에 따라 테스트 범위를 정하므로 모든 getter와 프레임워크 기본 동작을 테스트하는 식의 과잉 검증을 요구하지 않는다.

명시적으로 사용할 때:

```text
$deliver-dondok-feature 자산 등록 수직 기능을 구현해줘
```

## MCP 상태와 용도

### OpenAI Developer Docs

- 공식 원격 MCP `https://developers.openai.com/mcp`
- Codex, MCP, OpenAI 제품의 현재 설정을 확인할 때만 사용
- 전역 등록 완료, Codex 재시작 후 현재 세션에 노출됨

### Context7

- 원격 MCP `https://mcp.context7.com/mcp`
- Spring Boot/JPA, PostgreSQL, React, TanStack Query, Tailwind, shadcn, Playwright의 **사용 중인 버전** 문서를 확인할 때 사용
- 공개 라이브러리 이름·버전·질문만 전송한다. 프로젝트 코드, SQL 데이터, 환경변수, 사용자 정보를 보내지 않는다.
- 전역 등록과 OAuth 로그인을 완료했고 현재 세션에서 문서 도구 노출을 확인했다.

```bash
codex mcp login context7
codex mcp list
```

연결 상태가 바뀐 경우 Codex 앱 또는 CLI를 재시작한다.

### React PWA 문서 기준

- build/runtime: Vite + React SPA
- PWA 통합: `vite-plugin-pwa`
- service worker: manifest·아이콘·versioned static app shell만 관리
- 금지: API 응답·사용자 금융 데이터 cache, offline mutation queue
- 갱신: `virtual:pwa-register/react`의 사용자 확인 prompt를 사용해 작성 중 폼의 강제 reload를 피한다.

## 앱 생성 후 도입할 후보

### shadcn skill 또는 MCP — 조건부 추천

공식 shadcn registry를 검색하고 컴포넌트를 프로젝트 소스로 추가하는 데 유용하다. 현재 frontend는 shadcn 방식의 로컬 소스 컴포넌트를 사용하며, 새 복합 컴포넌트가 필요할 때 CLI가 실행할 diff를 검토하고 skill과 MCP 중 하나만 선택한다. 둘을 동시에 둘 필요는 없다.

### Playwright MCP — 기본 보류

브라우저 탐색에는 편리하지만 checked-in Playwright test를 대신하지 않는다. 현재 Codex의 in-app Browser와 QC의 `@playwright/test` 전략이 있어 기능이 중복된다. 도입한다면 `--isolated`, 허용된 돈독 origin 제한, workspace 밖 파일 접근 금지를 사용하고 로그인 profile을 공유하지 않는다.

### Sentry MCP — 관측 도구 채택 후

운영 오류 수집을 Sentry로 결정한 뒤 read 중심 권한으로 붙인다. 지금 붙이면 존재하지 않는 운영 데이터와 계정을 위한 복잡성만 늘어난다.

### Figma plugin — Figma를 원본으로 쓸 때만

UX/UI가 Figma를 실제 source of truth로 사용하게 되면 설치한다. 현재는 SVG와 CSS token이 Git 원본이므로 필수 아니다.

## 의도적으로 넣지 않는 MCP

- GitHub MCP: 현재 GitHub plugin과 중복된다.
- Filesystem/Git MCP: Codex가 이미 workspace와 Git CLI를 사용할 수 있다.
- Production PostgreSQL MCP: 운영 개인정보·금융 데이터 노출과 mutation 위험이 크다.
- Docker socket MCP: 컨테이너를 넘어 host 권한까지 확대될 수 있다.
- Memory MCP: 제품 결정은 `docs/project-context.md`와 Git history가 더 검토 가능하다.

DB 도구가 필요해지면 별도 개발 DB 계정, read-only, 제한된 schema, 짧은 수명 credential로만 평가한다.

## 공급망과 MCP 안전 규칙

skill과 로컬 MCP는 에이전트와 같은 사용자 권한으로 명령을 실행할 수 있다.

1. 공식 조직 또는 평판 있는 저장소를 우선한다.
2. 설치 수, star, 최근 release, 보안 평가, `SKILL.md`와 shell 명령을 함께 검토한다.
3. `latest` 명령을 운영 자동화에 그대로 두지 않고 실제 프로젝트 생성 시 version/lockfile로 고정한다.
4. MCP에는 필요한 tool만 노출하고 write/delete는 사용자 승인 대상으로 둔다.
5. remote MCP에는 secret이나 사유 코드를 보내지 않는다.
6. 로컬 MCP는 stdio와 최소 파일·네트워크 권한을 우선한다.
7. 운영 DB, Docker socket, SSH key와 홈 디렉터리를 MCP에 노출하지 않는다.

## Secret 방어

Git ignore만으로는 내용 기반 유출을 잡지 못하므로 앱 생성 전에 Gitleaks를 설치한다. 저장소는 public이므로 GitHub secret scanning과 push protection도 필수로 활성화한다.

```bash
brew install gitleaks
bash .agents/skills/deliver-dondok-feature/scripts/verify-harness.sh
```

CI에서는 `REQUIRE_GITLEAKS=1`로 실행한다. 최초 공개 push 전에 전체 Git history를 검사하고 운영 secret·백업·실사용 데이터가 artifact에 들어가지 않게 한다.

## 단계별 적용

### 지금

- root `AGENTS.md`
- 돈독 전용 feature delivery skill
- 검증된 외부 skill 3개와 lockfile
- OpenAI Docs/Context7 MCP 등록
- 환경파일 ignore와 harness 검사

### 애플리케이션 scaffold 시

- nested `AGENTS.md`와 실제 build/test 명령
- shadcn skill 또는 MCP 하나
- Gitleaks pre-commit/CI
- dependency update와 license/security scan

### 첫 수직 기능 완성 시

- Playwright checked-in E2E와 artifact 보존
- API schema diff와 DB migration smoke test
- 두 브라우저 세션의 version conflict와 focus/refetch 검증

### Mac mini 배포 전

- image vulnerability scan, SBOM, pinned base image
- Compose health/restart/log rotation 검증
- PostgreSQL backup/restore drill
- 공개 도메인의 TLS 자동 갱신, rate limit, CSRF, session/cookie hardening과 backend/DB 포트 비노출

## 조사 기준과 출처

- [OpenAI: AGENTS.md 계층과 발견 규칙](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [OpenAI: Codex skill 생성·저장 위치·progressive disclosure](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI: Codex MCP 구성](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Skills.sh 전체 순위와 설치 통계](https://www.skills.sh/)
- [Vercel React best practices skill](https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices)
- [Verification before completion skill](https://www.skills.sh/obra/superpowers/verification-before-completion)
- [Systematic debugging skill](https://www.skills.sh/obra/superpowers/systematic-debugging)
- [Context7 공식 저장소와 MCP 사용법](https://github.com/upstash/context7)
- [shadcn 공식 MCP 문서](https://ui.shadcn.com/docs/mcp)
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [MCP 공식 보안 권고](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Gitleaks 공식 저장소](https://github.com/gitleaks/gitleaks)
- [GitHub secret scanning 제공 범위](https://docs.github.com/en/code-security/reference/secret-security/secret-scanning-scope)
