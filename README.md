# 돈독

함께 기록하고 차곡차곡 모으는 공유 가계부입니다. 활성 멤버 N명이 동일한 권한으로 자산과 거래를 관리하고, 자산 소유 marker·경제활동 주체·작성자를 분리해 기록합니다.

## 현재 구현 범위

- PostgreSQL 18 + Flyway V1 스키마
- Spring Boot 4.1 / Java 17 / JPA 서버
- 아이디 중복 확인, 회원가입, 이메일 인증, 서버 세션 로그인
- 이메일 기반 비밀번호 재설정과 전체 세션 만료
- 가계부 생성, N명 구성원 조회, 7일·1회용 초대 URL·코드 발급·수락
- React 19 / Vite 8 / TanStack Query / Tailwind 기반 반응형 PWA
- 모바일·iPad·데스크톱 Playwright 인증·구성원 초대 흐름
- Mac mini용 Docker Compose + Caddy HTTPS 경계
- 저장소 밖 PostgreSQL 일일 백업·30일 보존과 network-none 격리 복구 drill

## 로컬 실행

실제 비밀값은 Git에 추가하지 않습니다.

```bash
cp .env.example .env
# .env의 CHANGE_ME 값을 로컬 값으로 변경
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait
```

- 돈독: `http://localhost:5173`
- 개발 메일함: `http://localhost:8025`
- 백엔드 health: `http://localhost:8080/actuator/health/readiness`

중지할 때는 데이터를 보존하려면 `docker compose -f compose.yaml -f compose.dev.yaml down`, 테스트 데이터를 포함해 지우려면 마지막에 `-v`를 추가합니다.

## 독립 검증

```bash
cd backend && set -a && source ../.env && set +a && ./gradlew test
cd frontend && npm ci && npm run lint && npm run build
cd e2e && npm ci && npx playwright test
```

제품 결정의 단일 기준은 [프로젝트 컨텍스트](docs/project-context.md)와 [결정 등록부](docs/product/open-decisions.md)입니다. 프론트엔드와 백엔드 사이의 공개 계약은 [OpenAPI](docs/api/openapi.yaml)에 있습니다.

운영 백업·복구 명령과 launchd 설치 전 점검은 [배포·복구 runbook](docs/operations/repository-and-deployment.md#데이터와-복구)을 따릅니다. dump·manifest·삭제 denylist는 저장소와 CI artifact에 넣지 않습니다.
